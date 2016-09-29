#include <nan.h>
#include "g726.h"

namespace FoscamG726Binding {

NAN_METHOD(encode) {
    if(info.Length() < 1) {
        Nan::ThrowTypeError("Wrong number of argumentsArgument should be a Buffer.");
        return;
    }

    if(!node::Buffer::HasInstance(info[0])) {
        Nan::ThrowTypeError("Argument should be a Buffer.");
        return;
    }

    v8::Local<v8::Object> inputObj = info[0]->ToObject();
    if(node::Buffer::Length(inputObj) != 960) {
        Nan::ThrowTypeError("Input must be a buffer containing 960 bytes (60 ms of 16-bit linear PCM mono samples at 8kHz).");
        return;
    }

    char* bitstream = reinterpret_cast<char*>(malloc(120));

    g726_Encode(reinterpret_cast<unsigned char*>(node::Buffer::Data(inputObj)), bitstream);

    Nan::MaybeLocal<v8::Object> bitstreamBuffer = Nan::NewBuffer(bitstream, 120);
    info.GetReturnValue().Set(bitstreamBuffer.ToLocalChecked());
}

NAN_MODULE_INIT(init) {
    Nan::Set(target, Nan::New("encode").ToLocalChecked(), Nan::GetFunction(Nan::New<v8::FunctionTemplate>(encode)).ToLocalChecked());
}

NODE_MODULE(FoscamG726, init);

}
