const os = require('os');
const net = require('net');
const cluster = require('cluster');
const delimiter = '\n';
const threadNo = 12;

if (cluster.isMaster && ((typeof(process.argv[2]) === 'undefined'))) {
 console.log("Pass through the port number as command line arguments\n Example: 'node index.js 80'");
} else {
  // Master thread
  if (cluster.isMaster) {
    var roomIds = 0;
    const workers = [];
    const availability = [];
    const chatrooms = [];
    for(var i = 1; i <= threadNo; i++) {
      workers[i] = cluster.fork();
      availability[i] = true;
    }

    // Setting listeners on each newly created worker to free threads
    // in the pool when they're closed and to listen for a kill service command. 
    workers.forEach((worker) => {
      worker.on('message', (message) => {
        // Free the thread in the pool.
        if (message.cmd && message.cmd == 'freeThread') {
          availability[message.id] = true;
        } 
        // Kill each worker and finally the service.
        else if (message.cmd && message.cmd == 'killService') {
          workers.forEach((worker) => {
            worker.kill(); 
          });
          // Give time for the kill commands to propogate fully.
          setTimeout(process.exit.bind(0), 10);
        } else if (message.cmd && message.cmd == 'joinChatroom') {
          if (typeof(chatrooms[message.chatroom]) === 'undefined') {
            chatrooms[message.chatroom] = {
              roomId: roomIds++,
              clientIds: []
            };

            chatrooms[message.chatroom].clientIds[message.clientId] = message.clientName;
            const joinNewAck = 'JOINED_CHATROOM:' + message.chatroom + '\n' +
                            'SERVER_IP:' + getCurrentIP() + '\n' +
                            'PORT:' + process.argv[2] + '\n' +
                            'ROOM_REF:' + chatrooms[message.chatroom].roomId + '\n' +
                            'JOIN_ID:' + message.clientId + '\n';

            workers[message.clientId].send({cmd: 'writeMessage', message: joinNewAck});
            var chatMessage = 'CHAT:' + chatrooms[message.chatroom].roomId + '\n' +
                          'CLIENT_NAME:' + message.clientName + '\n' +
                          'MESSAGE:' + message.clientName + ' has joined this chatroom.\n\n';
            workers[message.clientId].send({cmd: 'writeMessage', message: chatMessage});
          } else {
            var uniqueName = true;
            var chatroom = chatrooms[message.chatroom];

            chatroom.clientIds.forEach((name) => {
              if (name === message.clientName) {
                uniqueName = false;
              }
            });

            if (uniqueName) {
              const joinOldAck = 'JOINED_CHATROOM:' + message.chatroom + '\n' +
                              'SERVER_IP:' + getCurrentIP() + '\n' +
                              'PORT:' + process.argv[2] + '\n' +
                              'ROOM_REF:' + chatroom.roomId + '\n' +
                              'JOIN_ID:' + message.clientId + '\n';

              workers[message.clientId].send({cmd: 'writeMessage', message: joinOldAck});

              chatroom.clientIds[message.clientId] = message.clientName;
              for (var i = 0; i < chatroom.clientIds.length; i++) {
                if (typeof(chatroom.clientIds[i]) !== 'undefined') {
                  var chatMessage = 'CHAT:' + chatroom.roomId + '\n' +
                                'CLIENT_NAME:' + message.clientName + '\n' +
                                'MESSAGE:' + message.clientName + ' has joined this chatroom.\n\n';
                  workers[i].send({cmd: 'writeMessage', message: chatMessage});
                }
              }
            } else {
              workers[message.clientId].send({cmd: 'writeMessage', message: 'ERROR_CODE:1\nERROR_DESCRIPTION:Specified username is already taken.'})
            }
          }
        } else if (message.cmd && message.cmd == 'postMessage') {
          var chatroom;
          for (var room in chatrooms) {
            if (chatrooms[room].roomId === parseInt(message.chatroomId)) {
              chatroom = chatrooms[room];
              break;
            }
          };

          if (typeof(chatroom) !== 'undefined') {
            if (typeof(chatroom.clientIds[message.clientId]) !== 'undefined') {
              for (var i = 0; i < chatroom.clientIds.length; i++) {
                if (typeof(chatroom.clientIds[i]) !== 'undefined') {
                  const userMessage = 'CHAT:' + chatroom.roomId + '\n' +
                                      'CLIENT_NAME:' + message.clientName + '\n' +
                                      'MESSAGE:' + message.clientMessage + '\n\n';
                  workers[i].send({cmd: 'writeMessage', message: userMessage});
                }
              }
            } else {
              workers[message.clientId].send({cmd: 'writeMessage', message: 'ERROR_CODE:3\nERROR_DESCRIPTION:Client has not joined specified chatroom.'});
            }
          } else {
            workers[message.clientId].send({cmd: 'writeMessage', message: 'ERROR_CODE:4\nERROR_DESCRIPTION:Chatroom does not exist.'});
          }
        } else if (message.cmd && message.cmd == 'leaveChatroom') {
          var chatroom;
          for (var room in chatrooms) {
            if (chatrooms[room].roomId === parseInt(message.chatroomId)) {
              chatroom = chatrooms[room];
              break;
            }
          };

          if (typeof(chatroom) !== 'undefined') {
            if (typeof(chatroom.clientIds[message.clientId]) !== 'undefined') {
              var leaveRoomAck = 'LEFT_CHATROOM:' + chatroom.roomId + '\n' + 
                                 'JOIN_ID:' + message.clientId + '\n'
              workers[message.clientId].send({cmd: 'writeMessage', message: leaveRoomAck});
              for (var i = 0; i < chatroom.clientIds.length; i++) {
                if (typeof(chatroom.clientIds[i]) !== 'undefined') {
                  var chatMessage = 'CHAT:' + chatroom.roomId + '\n' +
                                'CLIENT_NAME:' + message.clientName + '\n' +
                                'MESSAGE:' + message.clientName + ' has left this chatroom.\n\n';
                  workers[i].send({cmd: 'writeMessage', message: chatMessage});
                }
              }
              chatroom.clientIds[message.clientId] = undefined;
            } else {
              workers[message.clientId].send({cmd: 'writeMessage', message: 'ERROR_CODE:3\nERROR_DESCRIPTION:Client has not joined specified chatroom.'});
            }
          } else {
            workers[message.clientId].send({cmd: 'writeMessage', message: 'ERROR_CODE:4\nERROR_DESCRIPTION:Chatroom does not exist.'});
          }
        } else if (message.cmd && message.cmd == 'disconnectClient') {
          for(var key in chatrooms) {
            if (typeof(chatrooms[key].clientIds[message.clientId]) !== 'undefined') {
              var clientName = chatrooms[key].clientIds[message.clientId];
              for(var i = 0; i < chatrooms[key].clientIds.length; i++) {
                if (typeof(chatrooms[key].clientIds[i]) !== 'undefined') {
                  var chatMessage = 'CHAT:' + chatrooms[key].roomId + '\n' +
                                'CLIENT_NAME:' + clientName + '\n' +
                                'MESSAGE:' + clientName + ' has left this chatroom.\n\n';
                  workers[i].send({cmd: 'writeMessage', message: chatMessage});
                }
              }
              chatrooms[key].clientIds[message.clientId] = undefined;
            }
          }

          workers[message.clientId].send({cmd: 'closeConnection'});
          availability[message.clientId] = true;
        }
      });
    });

    // Create the master server that will pass 
    // client connections to the workers.
    net.createServer((c) => {
      var threadId = 1;
      while (threadId <= workers.length && !availability[threadId]) {
        threadId++;
      }

      // If the id has iterated past the number of threads,
      // create a new thread for the client and add it to 
      // the thread pool.
      if (threadId <= workers.length) {
        workers[threadId].send({cmd: 'conn'}, c);
        console.log('New worker (old) ' + threadId);
        availability[threadId] = false;
      } else {
        workers[threadId] = cluster.fork();
        workers[threadId].send({cmd: 'conn'}, c);
        console.log('New worker (new) ' + threadId);
        availability[threadId] = false;
      }
    }).listen(process.argv[2]);
  } 
  // Worker Threads
  else {
    const server = net.createServer((client) => {
      // Send a message back to the master thread on close
      // to free this thread for another client.
      client.on('close', () => {
        process.send({ 
          cmd: 'disconnectClient', 
          clientId: cluster.worker.id,
          clientName: ''
        });
      });

      // Respond to 'HELO' and 'KILL_SERVICE' requests
      client.on('data', (data) => {
        console.log('IN ' + cluster.worker.id + ': ');
        console.log(data.toString());
        if (data.toString().substring(0, 4) === "HELO") {
          client.write(data + "IP:" + getCurrentIP() + "\nPort:" + process.argv[2] + "\nStudentID:13325852\n");
        } else if (data.toString().substring(0, 12) === "KILL_SERVICE") {
          process.send({ cmd: 'killService' });
        } else if (isJoinRoomRequest(data.toString())) {
          var splitData = data.toString().split(delimiter);
          process.send({ 
            cmd: 'joinChatroom', 
            clientId: cluster.worker.id,
            chatroom: splitData[0].substring(14, splitData[0].length).trim(),
            clientName: splitData[3].substring(12, splitData[3].length).trim()
          });
        } else if (isLeaveRoomRequest(data.toString())) {
          var splitData = data.toString().split(delimiter);
          process.send({ 
            cmd: 'leaveChatroom', 
            chatroomId: splitData[0].substring(15, splitData[0].length).trim(),
            clientId: splitData[1].substring(8, splitData[1].length).trim(),
            clientName: splitData[2].substring(12, splitData[2].length).trim()
          });
        } else if (isSendMessage(data.toString())) {
          var splitData = data.toString().split(delimiter);
          process.send({ 
            cmd: 'postMessage', 
            chatroomId: splitData[0].substring(5, splitData[0].length).trim(),
            clientId: splitData[1].substring(8, splitData[1].length).trim(),
            clientName: splitData[2].substring(12, splitData[2].length).trim(),
            clientMessage: splitData[3].substring(8, splitData[3].length).trim()
          });
        } else if (isDisconnectRequest(data.toString())) {
          var splitData = data.toString().split(delimiter);
          process.send({ 
            cmd: 'disconnectClient', 
            clientId: cluster.worker.id,
            clientName: splitData[0].substring(11, splitData[0].length).trim()
          });
        } else {
          // Anything goes here.
        }
      });
    });

    // Assign this thread's connection via the master thread.
    var client;
    process.on('message', function(msg, c) {
      if (msg.cmd === 'conn') {
        server.emit('connection', c);
        console.log('connected new worker!');
        client = c;
      } else if (msg.cmd === 'writeMessage' && typeof(client) !== 'undefined') {
        console.log('OUT ' + cluster.worker.id + ': ');
        console.log(msg.message);
        client.write(msg.message);
      } else if (msg.cmd === 'closeConnection' && typeof(client) !== 'undefined') {
        console.log('Destroying worker soon' + cluster.worker.id);
        setTimeout(client.destroy, 10);
      }
    });
  };

  function isJoinRoomRequest(request) {
    const splitRequest =  request.split(delimiter);
    return ((splitRequest[0].substring(0, 14) === "JOIN_CHATROOM:") && (splitRequest[1].substring(0, 10) === "CLIENT_IP:") && 
              (splitRequest[2].substring(0, 5) === "PORT:") && (splitRequest[3].substring(0, 12) === "CLIENT_NAME:"));
  };

  function isLeaveRoomRequest(request) {
    const splitRequest =  request.split(delimiter);
    return ((splitRequest[0].substring(0, 15) === "LEAVE_CHATROOM:") && (splitRequest[1].substring(0, 8) === "JOIN_ID:") && 
              (splitRequest[2].substring(0, 12) === "CLIENT_NAME:"));
  };

  function isSendMessage(request) {
    const splitRequest =  request.split(delimiter);
    return ((splitRequest[0].substring(0, 5) === "CHAT:") && (splitRequest[1].substring(0, 8) === "JOIN_ID:") && 
              (splitRequest[2].substring(0, 12) === "CLIENT_NAME:") && (splitRequest[3].substring(0, 8) === "MESSAGE:"));
  };

  function isDisconnectRequest(request) {
    const splitRequest =  request.split(delimiter);
    return ((splitRequest[0].substring(0, 11) === "DISCONNECT:") && (splitRequest[1].substring(0, 5) === "PORT:") && 
              (splitRequest[2].substring(0, 12) === "CLIENT_NAME:"));
  };
};

function getCurrentIP() {
  var interfaces = os.networkInterfaces();
  var addresses = [];
  for (var k in interfaces) {
      for (var k2 in interfaces[k]) {
          var address = interfaces[k][k2];
          if (address.family === 'IPv4' && !address.internal) {
              addresses.push(address.address);
          }
      }
  }
  return addresses[0];
};