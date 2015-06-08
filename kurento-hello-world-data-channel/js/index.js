/*
* (C) Copyright 2014-2015 Kurento (http://kurento.org/)
*
* All rights reserved. This program and the accompanying materials
* are made available under the terms of the GNU Lesser General Public License
* (LGPL) version 2.1 which accompanies this distribution, and is available at
* http://www.gnu.org/licenses/lgpl-2.1.html
*
* This library is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
* Lesser General Public License for more details.
*
*/

function getopts(args, opts)
{
  var result = opts.default || {};
  args.replace(
      new RegExp("([^?=&]+)(=([^&]*))?", "g"),
      function($0, $1, $2, $3) { result[$1] = $3; });

  return result;
};

var args = getopts(location.search,
{
  default:
  {
    ws_uri: 'ws://' + location.hostname + ':8888/kurento',
    ice_servers: undefined
  }
});

if (args.ice_servers) {
  console.log("Use ICE servers: " + args.ice_servers);
  kurentoUtils.WebRtcPeer.prototype.server.iceServers = JSON.parse(args.ice_servers);
} else {
  console.log("Use freeice")
}


function setIceCandidateCallbacks(webRtcPeer, webRtcEp, onerror)
{
  webRtcPeer.on('icecandidate', function(candidate) {
    console.log("Local candidate:",candidate);

    candidate = kurentoClient.register.complexTypes.IceCandidate(candidate);

    webRtcEp.addIceCandidate(candidate, onerror)
  });

  webRtcEp.on('OnIceCandidate', function(event) {
    var candidate = event.candidate;

    console.log("Remote candidate:",candidate);

    webRtcPeer.addIceCandidate(candidate, onerror);
  });
}


window.addEventListener('load', function()
{
  console = new Console('console', console);

  $('#send').attr('disabled', true)

  var webRtcPeer;
  var pipeline;

  var videoInput = document.getElementById('videoInput');
  var videoOutput = document.getElementById('videoOutput');

  var startButton = document.getElementById('start');
  var stopButton = document.getElementById('stop');

  //DataChannel stuff bellow this line
  //inspired in this example
  //https://github.com/webrtc/samples/blob/gh-pages/src/content/datachannel/basic/js/main.js
  //TODO
  //This is ignoring ice servers. We should patch kurento-utils-js
  //for being able to do this correctly.
  console.log("Creating external peerConnection");
  var servers = null;
  var configuration = null;
  var peerConnection = new RTCPeerConnection(servers, configuration);

  console.log("Creating sendChannel");
  var dataConstraints = null;
  var sendChannel = peerConnection.createDataChannel('sendDataChannel',
  dataConstraints);

  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onclose = onSendChannelStateChange;
  function onSendChannelStateChange(){
    if(!sendChannel) return;
    var readyState = sendChannel.readyState;
    console.log("sencChannel state changed to " + readyState);
    if(readyState == 'open'){
      dataChannelSend.disabled = false;
      dataChannelSend.focus();
      $('#send').attr('disabled', false)
    } else {
      dataChannelSend.disabled = true;
      $('#send').attr('disabled', true)
    }
  }

  var sendButton = document.getElementById('send');
  var dataChannelSend = document.getElementById('dataChannelSend')

  sendButton.addEventListener("click", function(){
    var data = dataChannelSend.value;
    console.log("Send button pressed. Sending data " + data);
    sendChannel.send(data);
  });


  var receiveChannel;
  peerConnection.ondatachannel = receiveChannelCallback;
  function receiveChannelCallback(event){
    console.log("receiveChannelCallback invoked")
    receiveChannel = event.channel;
    receiveChannel.onmessage = onReceiveMessageCallback;
    function onReceiveMessageCallback(event) {
      console.log('receiveChannel received data ' + event.data);
      dataChannelReceive.value = event.data;
    }
    receiveChannel.onopen = onReceiveChannelStateChange;
    receiveChannel.onclose = onReceiveChannelStateChange;
    function onReceiveChannelStateChange() {
      if(!receiveChannel) return;
      var readyState = receiveChannel.readyState;
      console.log('receiveChannel state changed to: ' + readyState);
    }
  }

  function closeChannels(){

    if(sendChannel){
      sendChannel.close();
      dataChannelSend.disabled = true;
      $('#send').attr('disabled', true)
      sendChannel = null;
    }
    if(receiveChannel){
      receiveChannel.close();
      receiveChannel = null;
    }
  }

  //DataChannel stuff above this line

  startButton.addEventListener("click", function()
  {
    showSpinner(videoInput, videoOutput);

    var options = {
      peerConnection: peerConnection,
      localVideo: videoInput,
      remoteVideo: videoOutput
    };

    webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error)
    {
      if(error) return onError(error)

      this.generateOffer(onOffer)
    });

    function onOffer(error, sdpOffer)
    {
      if(error) return onError(error)

      kurentoClient(args.ws_uri, function(error, kurentoClient)
      {
        if(error) return onError(error);

        kurentoClient.create("MediaPipeline", function(error, _pipeline)
        {
          if(error) return onError(error);

          pipeline = _pipeline;

          pipeline.create("WebRtcEndpoint", function(error, webRtc){
            if(error) return onError(error);

            setIceCandidateCallbacks(webRtcPeer, webRtc, onError)

            webRtc.processOffer(sdpOffer, function(error, sdpAnswer){
              if(error) return onError(error);

              webRtc.gatherCandidates(onError);

              webRtcPeer.processAnswer(sdpAnswer, onError);
            });

            webRtc.connect(webRtc, function(error){
              if(error) return onError(error);

              console.log("Loopback established");
            });
          });
        });
      });
    }
  });
  stopButton.addEventListener("click", stop);

  function stop() {

    closeChannels();

    if (webRtcPeer) {
      webRtcPeer.dispose();
      webRtcPeer = null;
    }

    if(pipeline){
      pipeline.release();
      pipeline = null;
    }

    hideSpinner(videoInput, videoOutput);
  }

  function onError(error) {
    if(error)
    {
      console.error(error);
      stop();
    }
  }
})


function showSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].poster = 'img/transparent-1px.png';
    arguments[i].style.background = "center transparent url('img/spinner.gif') no-repeat";
  }
}

function hideSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].src = '';
    arguments[i].poster = 'img/webrtc.png';
    arguments[i].style.background = '';
  }
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
  event.preventDefault();
  $(this).ekkoLightbox();
});