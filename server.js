var bodyParser = require('body-parser'),
    cors       = require('cors'),
    express    = require('express');

var config       = require('./lib/config'),
    Controller   = require('./lib/Controller'),
    SSHDataRelay = require('./lib/SSHDataRelay'),
    Scheduler    = require('./lib/Scheduler');

var app = express(),
    server, controller, dataRelay, scheduler;

// enable cross-origin requests
app.use(cors(function(req, callback) {
    var origin      = req.header('Origin'),
        corsAllowed = false;
    if (/^http:\/\/localhost:\d+$/.test(origin)) {
        corsAllowed = true;
    } else if (/^https?:\/\/(www\.)?redmountainmakers\.org$/.test(origin)) {
        corsAllowed = true;
    }
    callback(null, { origin : corsAllowed });
}));

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

app.get('/schedule', function(req, res) {
    res.json(scheduler.getStatus());
});

app.post('/schedule', function(req, res) {
    try {
        if (req.body.schedule === null || req.body.schedule === 'null') {
            scheduler.clearSchedule();
        } else {
            scheduler.setSchedule(req.body.schedule);
        }
        res.json({ ok : true });
    } catch (err) {
        res.json({
            ok    : false,
            error : err.message
        });
    }
});

server = app.listen(config.httpPort, function() {
    console.log('listening on :' + config.httpPort);

    var settings = {
        deviceName     : config.serialPort,
        pidTunings     : config.pidTunings,
        minTemperature : config.temperatures.min,
        maxTemperature : config.temperatures.max
    };

    controller = new Controller(settings);
    controller.on('log', function(msg) {
        console.log(msg);
    });

    scheduler = new Scheduler(settings, controller);

    dataRelay = new SSHDataRelay(config.ssh, controller, scheduler);
    dataRelay.on('log', function(msg) {
        console.log(msg);
    });

    process.on('SIGINT', function() {
        console.log();
        dataRelay.close();
        controller.close();
        process.exit(); // HTTP server probably won't close
    });
});
