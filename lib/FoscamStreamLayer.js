"use strict";

const crypto = require('crypto');
const FoscamEncryptionLayer = require('./FoscamEncryptionLayer');
const FoscamG726 = require('../build/Release/FoscamG726');

class FoscamStreamLayer extends FoscamEncryptionLayer {
    constructor(host, port, username, password) {
        super(host, port);
        let self = this;

        self.username = username;
        self.password = password;
        self.groupID = crypto.randomBytes(4).readUInt32LE(0);

        self.handlers = {};
    }

    startVideoStream(isMain) {
        let self = this;
        return self.connect().then(() => {
            let buffer = Buffer.alloc(161);
            buffer.writeUInt8(isMain ? 0 : 1, 0);
            buffer.write(self.username, 1, Math.min(64, self.username.length), 'utf8');
            buffer.write(self.password, 65, Math.min(64, self.password.length), 'utf8');
            buffer.writeUInt32LE(self.groupID, 129);
            self.sendPacket(0, buffer);
        });
    }

    addHandler(type, callback) {
        let self = this;
        if(!self.handlers[type])
            self.handlers[type] = [];
        self.handlers[type].push(callback);
    }

    callHandlers(type, payload) {
        let self = this;
        if(!self.handlers[type])
            return;

        for(let handler of self.handlers[type]) {
            handler(payload);
        }

        self.handlers[type] = [];
    }

    startTalkStream() {
        let self = this;
        return self.connect().then(() => {
            let buffer = Buffer.alloc(160);
            buffer.write(self.username, 0, Math.min(64, self.username.length), 'utf8');
            buffer.write(self.password, 64, Math.min(64, self.password.length), 'utf8');
            buffer.writeUInt32LE(self.groupID, 128);
            let promise = new Promise((resolve, reject) => {
                self.addHandler(20, (payload) => {
                    if(payload.length < 4) {
                        reject();
                        return;
                    }

                    let ret = payload.readUInt32LE(0);
                    if(ret == 0)
                        resolve();
                    else
                        reject();
                });
            });

            self.sendPacket(4, buffer);
        });
    }

    receivedPacket(type, payload) {
        let self = this;
        let result = super.receivedPacket(type, payload);
        if(!result)
            return null;

        type = result[0];
        payload = result[1];

        console.log("Processed", type, payload);
        self.callHandlers(type, payload);
    }

    sendTalkData(samples) {
        let self = this;
        let data = FoscamG726.encode(samples)
        let header = Buffer.alloc(4);
        header.writeUInt32LE(data.length, 0);
        self.sendPacket(6, Buffer.concat([header, data]));
    }
}

module.exports = FoscamStreamLayer;
