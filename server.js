var express = require('express');

var Controller = require('./lib/controller');

var app = express(),
    controller, server;

app.get('/status', function(req, res) {
    res.json(controller.getStatus());
});

function sendCommandResponse(err, res) {
    if (err) {
        res.status(500).json({
            ok    : false,
            error : err.message
        });
    } else {
        res.json({ ok : true });
    }
}

app.post('/on', function(req, res) {
    controller.enableRelays(function(err) {
        sendCommandResponse(err, res);
    });
});

app.post('/off', function(req, res) {
    controller.disableRelays(function(err) {
        sendCommandResponse(err, res);
    });
});

server = app.listen(3000, function() {
    console.log('listening on :3000');

    controller = new Controller('/dev/ttyACM0');
    controller.on('log', function(msg) {
        console.log(msg);
    });

    process.on('SIGINT', function() {
        console.log();
        controller.close(function(err) {
            if (err) throw err;
            console.log('serial port closed');
            server.close(function(err) {
                if (err) throw err;
                console.log('HTTP server closed');
            });
        });
    });
});
