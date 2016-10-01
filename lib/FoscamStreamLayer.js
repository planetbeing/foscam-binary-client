"use strict";

const crypto = require('crypto');
const FoscamEncryptionLayer = require('./FoscamEncryptionLayer');
const FoscamG726 = require('../build/Release/FoscamG726');

class FoscamStreamLayer extends FoscamEncryptionLayer {
    constructor(host, port, username, password, loginIsMain = true) {
        super(host, port);
        let self = this;

        self.username = username;
        self.password = password;
        self.groupID = crypto.randomBytes(4).readUInt32LE(0);
        self.loginIsMain = loginIsMain;

        self.handlers = {};
        self.pendingLogin = null;
        self.keepAliveTimeout = null;
    }

    connect() {
        let self = this;
        if(self.pendingLogin)
            return self.pendingLogin;

        self.pendingLogin = super.connect().then(() => {
            return self.login(self.loginIsMain);
        });

        return self.pendingLogin;
    };

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

    login(isMain) {
        let self = this;
        return new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(164);
            buffer.write(self.username, 0, Math.min(64, self.username.length), 'utf8');
            buffer.write(self.password, 64, Math.min(64, self.password.length), 'utf8');
            buffer.writeUInt32LE(self.groupID, 128);
            buffer.writeUInt32LE(isMain ? 0 : 1, 132);
            self.addHandler(100, (payload) => {
                if(payload.length < 4) {
                    reject();
                    return;
                }

                let ret = payload.readUInt32LE(0);
                if(ret != 0) {
                    reject({message: 'Login failed', code: ret, data: payload});
                    return;
                }

                if(self.keepAliveTimeout)
                    clearTimeout(self.keepAliveTimeout);
                self.doKeepAlive();

                resolve(payload);
            });

            self.sendPacket(12, buffer);
        });
    }

    keepAlive() {
        let self = this;
        return self.connect().then(() => {
            let buffer = Buffer.alloc(4);
            buffer.writeUInt32LE(self.groupID, 0);
            let promise = new Promise((resolve, reject) => {
                self.addHandler(29, (payload) => {
                    if(payload.length < 4) {
                        reject();
                        return;
                    }

                    let ret = payload.readUInt32LE(0);
                    if(ret == 0)
                        resolve(payload);
                    else
                        reject({message: 'Keepalive failed', code: ret, data: payload});
                });
            });

            self.sendPacket(15, buffer);
            return promise;
        });
    }

    doKeepAlive() {
        let self = this;
        self.keepAlive();
        self.keepAliveTimeout = setTimeout(self.doKeepAlive.bind(self), 3000);
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
            return promise;
        });
    }

    stopTalkStream() {
        let self = this;
        return self.connect().then(() => {
            let buffer = Buffer.alloc(160);
            buffer.write(self.username, 0, Math.min(64, self.username.length), 'utf8');
            buffer.write(self.password, 64, Math.min(64, self.password.length), 'utf8');
            buffer.writeUInt32LE(self.groupID, 128);
            let promise = new Promise((resolve, reject) => {
                self.addHandler(21, (payload) => {
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

            self.sendPacket(5, buffer);
            return promise;
        });
    }

    receivedPacket(type, payload) {
        let self = this;
        let result = super.receivedPacket(type, payload);
        if(!result)
            return null;

        type = result[0];
        payload = result[1];

        self.callHandlers(type, payload);

        if(type == 111)
            self.emit('motion', payload);
    }

    sendTalkData(samples, compressed) {
        let self = this;
        let data = samples;
        if(compressed)
            data = FoscamG726.encode(data);
        let header = Buffer.alloc(4);
        header.writeUInt32LE(data.length, 0);
        self.sendPacket(6, Buffer.concat([header, data]));
    }
}

module.exports = FoscamStreamLayer;
