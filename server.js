var bodyParser = require('body-parser'),
    cors       = require('cors'),
    express    = require('express');

var Controller = require('./lib/controller');

var app = express(),
    controller, server;

// enable cross-origin requests
app.use(cors());

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

// parse application/json
app.use(bodyParser.json());

app.get('/status', function(req, res) {
    res.json(controller.getStatus());
});

app.get('/history', function(req, res) {
    res.json(controller.getHistory());
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

app.post('/set', function(req, res) {
    var temperature = parseFloat(req.body.temperature);
    if (isNaN(temperature) || temperature < 0) {
        res.status(400).json({
            ok    : false,
            error : "Parameter 'temperature' must be a non-negative number"
        });
    } else {
        controller.setTargetTemperature(temperature);
        res.json({ ok : true });
    }
});

app.get('/tunings', function(req, res) {
    res.json(controller.getTunings());
});

app.post('/tunings', function(req, res) {
    var Kp = parseFloat(req.body.Kp),
        Ki = parseFloat(req.body.Ki),
        Kd = parseFloat(req.body.Kd);
    if (isNaN(Kp) || isNaN(Ki) || isNaN(Kd)) {
        res.status(400).json({
            ok    : false,
            error : "Parameters 'Kp', 'Ki', and 'Kd' must be numbers"
        });
    } else {
        controller.setTunings(Kp, Ki, Kd);
        res.json({ ok : true });
    }
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
            process.exit(); // HTTP server probably won't close
        });
    });
});
