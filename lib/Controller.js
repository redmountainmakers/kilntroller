var events = require('events'),
    fs     = require('fs'),
    moment = require('moment'),
    path   = require('path'),
    serial = require('serialport'),
    util   = require('util');

var PID = require('./pid');

function Controller(settings) {
    var self = this;

    if (!(self instanceof Controller)) {
        return new Controller(settings);
    }

    self.settings = settings;

    self.status = {
        raw : {
            R : 0
        },
        computed : {
            temperature : 22
        },
        setpoint : 0
    };

    self.history = [];

    self.port = new serial.SerialPort(settings.deviceName, {
        baudRate : 115200,
        parser   : serial.parsers.readline('\n')
    });

    self.port.on('open', self._onPortOpen.bind(self));
    self.port.on('data', self._onPortData.bind(self));

    self._isFirstLine = true;

    self.Kp = settings.pidTunings.Kp;
    self.Ki = settings.pidTunings.Ki;
    self.Kd = settings.pidTunings.Kd;

    self.pid = new PID(
        self.status.computed.temperature,
        self.status.setpoint,
        self.Kp,
        self.Ki,
        self.Kd,
        'direct'
    );

    self.pidInterval = 2000;
    self.pid.setSampleTime(self.pidInterval);
    self.pid.setMode('auto');
    self.setTargetTemperature(0);

    self.pidIntervalHandle = setInterval(self._pidStep.bind(self), self.pidInterval);
}

util.inherits(Controller, events.EventEmitter);

Controller.prototype.enableRelays = function(cb) {
    var self = this;

    self._sendCommand('ON', cb);
};

Controller.prototype.disableRelays = function(cb) {
    var self = this;

    self._sendCommand('OFF', cb);
};

Controller.prototype.getTargetTemperature = function() {
    var self = this;

    return self.status.setpoint;
};

Controller.prototype.setTargetTemperature = function(temp) {
    var self = this;

    if (
        temp !== 0 && (
            temp < self.settings.minTemperature ||
            temp > self.settings.maxTemperature
        )
    ) {
        throw new Error(util.format(
            'Temperature must be between %d and %d (or 0 to disable)',
            self.settings.minTemperature,
            self.settings.maxTemperature
        ));
    }

    self.status.setpoint = temp;
    self.pid.setPoint(temp);
    self.pid.setOutputLimits(
        self.settings.minTemperature,
        self.settings.maxTemperature
    );
};

Controller.prototype.getStatus = function() {
    var self = this;

    return self.status;
};

Controller.prototype.getHistory = function() {
    var self = this;

    return self.history;
};

Controller.prototype.getTunings = function() {
    var self = this;

    return {
        Kp : self.Kp,
        Ki : self.Ki,
        Kd : self.Kd
    };
};

Controller.prototype.setTunings = function(Kp, Ki, Kd) {
    var self = this;

    self.Kp = Kp;
    self.Ki = Ki;
    self.Kd = Kd;
    self.pid.setTunings(Kp, Ki, Kd);
};

Controller.prototype.close = function() {
    var self = this;

    clearInterval(self.pidIntervalHandle);
    self.pidIntervalHandle = null;
};

Controller.prototype._pidStep = function() {
    var self = this;

    var currentTemp = self.status.computed.temperature;

    self.pid.setInput(currentTemp);
    self.pid.compute();

    self.history.push({
        timestamp   : self.status.timestamp,
        temperature : currentTemp,
        target      : self.status.setpoint
    });
    while (self.history.length > 4000) {
        self.history.shift();
    }

    if (self.status.setpoint === 0) {
        if (self.status.raw.R) {
            self.disableRelays();
        }
        return;
    }

    var output = self.pid.getOutput(),
        enable = (output > self.status.setpoint);

    if (enable) {
        self.enableRelays();
    } else {
        self.disableRelays();
    }

    function round(n) {
        return Math.round(n * 100) / 100;
    }

    self.emit('log', util.format(
        'temp=%d setpoint=%d PID=%d relays=%s',
        round(currentTemp),
        round(self.status.setpoint),
        round(output),
        (enable ? 'ON' : 'OFF')
    ));
};

Controller.prototype._sendCommand = function(command, cb) {
    var self = this;

    self.port.write(command + '\r\n', function(err) {
        if (typeof cb === 'function') {
            cb(err);
        }
    });
};

Controller.prototype._onPortOpen = function() {
    var self = this;

    // Clear the command buffer
    self.port.write('\r\n\r\n', function(err) {
        if (err) {
            return self.emit('error', err);
        }
        self.emit('log', 'serial port open');
    });
};

Controller.prototype._onPortData = function(line) {
    var self = this;

    if (self.isFirstLine) {
        // Discard partial first line received
        self.isFirstLine = false;
        return;
    }

    line = line.trim();
    self.emit('log', 'rx: ' + line);

    // Look for a pattern like var=value with an integer value and a space
    // afterwards
    var match = line.match(/^([A-Z0-9]+)=([0-9]+) /);
    if (!match) {
        return;
    }

    var name  = match[1],
        value = +match[2];

    self.status.raw[name] = value;

    // This is a temperature reading
    if (/^T/.test(name)) {
        if (name in self.status.computed) {
            // We already have a reading for this sensor; use the previous
            // value to compute a moving average
            self.status.computed[name] =
                self.status.computed[name] * 4 / 5 +
                value / 100 * 1 / 5;
        } else {
            // First value for this sensor
            self.status.computed[name] = value / 100;
        }
        var averageTemp = 0,
            numTemps    = 0;
        for (var i = 1; i <= 3; i++) {
            name = 'T' + i;
            if (name in self.status.computed) {
                averageTemp += self.status.computed[name];
                numTemps++;
            }
        }
        if (numTemps > 0) {
            averageTemp /= numTemps;
            self.status.computed.temperature = averageTemp;
            self.status.timestamp = +moment.utc();
            if (self._updateTimeout) {
                clearTimeout(self._updateTimeout);
            }
            self._updateTimeout = setTimeout(self._sendUpdate.bind(self), 250);
        }
    }
};

Controller.prototype._sendUpdate = function() {
    var self = this;

    self.emit('update', self.status);
    self._updateTimeout = null;
};

module.exports = Controller;
