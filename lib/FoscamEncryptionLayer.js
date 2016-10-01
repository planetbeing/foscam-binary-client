"use strict";

const http = require('http');
const NodeRSA = require('node-rsa');
const crypto = require('crypto');
const xml2js = require('xml2js');
const FoscamPacketLayer = require('./FoscamPacketLayer');

class FoscamEncryptionLayer extends FoscamPacketLayer {
    constructor(host, port) {
        super(host, port);
        let self = this;

        self.rsaKey = new NodeRSA();
        self.rsaKey.generateKeyPair(512, 65537);

        self.aesKey = null;

        self.pendingEncryptionNegotiation = null;
        self.pendingReceiveEncryptedAESKey = null;
        self.encrypted = false;
    }

    connect() {
        let self = this;
        if(self.pendingEncryptionNegotiation)
            return self.pendingEncryptionNegotiation;

        self.pendingEncryptionNegotiation = new Promise((resolve, reject) => {
            let req = http.request({'host': self.host, 'port': self.port, 'path': '/cgi-bin/CGIProxy.fcgi?cmd=getSWFlag'}, (response) => {
                let str = '';
                response.on('data', chunk => {
                    str += chunk;
                });

                response.on('end', () => {
                    resolve(str);
                });

                response.on('error', () => {
                    reject(err);
                });
            });

            req.on('error', err => {
                reject(err);
            });

            req.end();
        }).then(str => {
            return new Promise((resolve, reject) => {
                xml2js.parseString(str, (err, result) => {
                    if(err) {
                        reject(err);
                        return;
                    }

                    resolve(result);
                });
            });
        }).then(options => {
            return new Promise((resolve, reject) => {
                if(parseInt(options['CGI_Result']['result']) != 0) {
                    reject({'message': 'Could not get swflags.', options: options});
                    return;
                }

                let flags = parseInt(options['CGI_Result']['flag'], 16);
                if(flags & 0x10) {
                    resolve(true);
                    return;
                }

                resolve(false);
            });
        }).then(encrypted => {
            self.encrypted = encrypted;
            if(!encrypted)
                return super.connect();

            return super.connect().then(() => {
                let promise = self.receiveEncryptedAESKey();
                self.sendRSAPublicKey();
                return promise;
            }); 
        });

        return self.pendingEncryptionNegotiation;
    }

    sendRSAPublicKey() {
        let self = this;
        let publicKey = self.rsaKey.exportKey('pkcs1-public-der');
        let keyHeader = Buffer.alloc(12);
        keyHeader.writeUInt32LE(0, 0);
        keyHeader.writeUInt32LE(publicKey.length, 4);
        keyHeader.writeUInt32LE(0, 8);

        let rsaPublicKeyPacket = Buffer.concat([keyHeader, publicKey]);

        super.sendPacket(600, rsaPublicKeyPacket);
    }

    receiveEncryptedAESKey() {
        let self = this;
        if(self.pendingReceiveEncryptedAESKey)
            return self.pendingReceiveEncryptedAESKey.promise;

        self.pendingReceiveEncryptedAESKey = {};

        self.pendingReceiveEncryptedAESKey.promise = new Promise((resolve, reject) => {
            self.pendingReceiveEncryptedAESKey.resolve = resolve;
            self.pendingReceiveEncryptedAESKey.reject = reject;
        });

        return self.pendingReceiveEncryptedAESKey.promise;
    }

    receivedEncryptedAESKey(packet) {
        let self = this;
        if(!self.pendingReceiveEncryptedAESKey)
            return;

        // node-rsa doesn't truly support no padding. Its no padding is actually left zero padding.
        // We have to use the crypto module.

        let decrypted = crypto.privateDecrypt({
            'key': self.rsaKey.exportKey('private'),
            'padding': crypto.constants.RSA_NO_PADDING
        }, packet);

        let padding = decrypted.readUInt32LE(0);
        if(padding != 0) {
            self.pendingReceiveEncryptedAESKey.reject({'message': 'Wrapped key has bad padding.', 'key': decrypted});
            return;
        }

        let keyLength = decrypted.readUInt32LE(4);
        if((12 + keyLength) > decrypted.length) {
            self.pendingReceiveEncryptedAESKey.reject({'message': 'Wrapped key not long enough.', 'key': decrypted});
            return;
        }

        self.aesKey = decrypted.slice(12, 12 + keyLength);

        self.pendingReceiveEncryptedAESKey.resolve();
    }

    receivedPacket(type, packet) {
        let self = this;
        let result = super.receivedPacket(type, packet);
        if(!result)
            return null;

        if(type == 600) {
            self.receivedEncryptedAESKey(packet);
            return null;
        }

        if(type != 26)
            return [type, self.decryptAll(packet)];

        if(packet.length > 128)
            return [type, self.decryptSome(packet)];

        return [type, packet];
    }

    encryptAll(packet) {
        let self = this;
        if(!self.encrypted)
            return packet;

        let cipher = crypto.createCipheriv('AES-128-CBC', self.aesKey, Buffer.alloc(16));
        cipher.setAutoPadding(false);

        let buffers = [];
        buffers.push(cipher.update(packet));

        // Pad with zeroes
        let lastPacketLength = packet.length % 16;
        if(lastPacketLength != 0)
            buffers.push(cipher.update(Buffer.alloc(16 - lastPacketLength)));

        buffers.push(cipher.final());

        return Buffer.concat(buffers);
    }

    decryptAll(packet) {
        let self = this;
        if(!self.encrypted)
            return packet;

        let cipher = crypto.createDecipheriv('AES-128-CBC', self.aesKey, Buffer.alloc(16));
        cipher.setAutoPadding(false);

        let buffers = [];
        buffers.push(cipher.update(packet));
        buffers.push(cipher.final());

        return Buffer.concat(buffers);
    }

    encryptSome(packet) {
        let self = this;
        if(!self.encrypted)
            return packet;

        if(packet.length <= 128)
            return self.encryptAll(packet);

        // On large data packets, Foscam encrypts the first 128 bytes of every 4096 byte block (!!).
        let left = packet.length;
        let offset = 0;
        while(left > 128) {
            self.encryptAll(packet.slice(offset, offset + 128)).copy(packet, offset);
            offset += 4096;
            left -= 4096;
        }

        return packet;
    }

    decryptSome(packet) {
        let self = this;
        if(!self.encrypted)
            return packet;

        if(packet.length <= 128)
            return self.decryptAll(packet);

        // On large packets, Foscam encrypts the first 128 bytes of every 4096 byte block (!!).
        let left = packet.length;
        let offset = 0;
        while(left > 128) {
            self.decryptAll(packet.slice(offset, offset + 128)).copy(packet, offset);
            offset += 4096;
            left -= 4096;
        }

        return packet;
    }

    sendPacket(type, payload) {
        let self = this;
        let encrypted;
        if(type == 4)
            encrypted = self.encryptSome(payload);
        else
            encrypted = self.encryptAll(payload);

        super.sendPacket(type, encrypted);
    }
}

module.exports = FoscamEncryptionLayer;
