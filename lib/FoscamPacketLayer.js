"use strict";

const net = require('net');
const EventEmitter = require('events').EventEmitter;

class FoscamPacketLayer extends EventEmitter {
    constructor(host, port) {
        super();
        let self = this;

        self.pendingConnection = null;

        self.host = host;
        self.port = port;

        self.buffer = Buffer.alloc(0);
        self.closed = false;
    }

    connect() {
        let self = this;
        if(self.pendingConnection)
            return self.pendingConnection;

        let promise = new Promise((resolve, reject) => {
            if(self.closed) {
                reject({message: 'FoscamPacketLayer already closed'});
            }

            let errorHandler = err => {
                if(self.pendingConnection != promise)
                    return;

                reject(err);
            }

            self.socket = net.connect(self.port, self.host, () => {
                self.socket.removeListener('error', errorHandler);
                self.sendOpening();
                resolve();
            });

            self.socket.on('error', errorHandler);

            self.socket.on('data', data => {
                self.receivedData(data);
            });
        });

        self.pendingConnection = promise;

        return self.pendingConnection;
    }

    sendOpening() {
        let self = this;
        let opening = 'SERVERPUSH / HTTP/1.1\r\nHost: ' + self.host + ':' + self.port.toString() + '\r\nAccept:*/*\r\nConnection: Close\r\n\r\n';
        self.socket.write(new Buffer(opening));
    }

    receivedData(data) {
        let self = this;
        self.buffer = Buffer.concat([self.buffer, data]);

        while(self.buffer.length >= 12) {
            let magic = self.buffer.readUInt32BE(4);
            if(magic != 0x464F5343) {
                self.buffer = self.buffer.slice(1);
                continue;
            }

            let length = self.buffer.readUInt32LE(8);

            let packetLength = 12 + length;
            if(self.buffer.length < packetLength)
                break;

            let type = self.buffer.readUInt32LE(0);
            self.receivedPacket(type, self.buffer.slice(12, packetLength));
            self.buffer = self.buffer.slice(packetLength);
        }
    }

    receivedPacket(type, packet) {
        let self = this;
        return [type, packet];
    }

    sendPacket(type, payload) {
        let self = this;
        let header = Buffer.alloc(12);
        header.writeUInt32LE(type, 0);
        header.writeUInt32BE(0x464F5343, 4);
        header.writeUInt32LE(payload.length, 8);

        let packet = Buffer.concat([header, payload]);
        self.socket.write(packet);
    }

    close() {
        let self = this;
        self.closed = true;
        if(self.socket)
            self.socket.end();
    }
}

module.exports = FoscamPacketLayer;
