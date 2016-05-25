var events = require('events'),
    fs     = require('fs'),
    path   = require('path'),
    serial = require('serialport'),
    util   = require('util');

var PID = require('./pid');

function Controller(deviceName) {
    var self = this;

    if (!(self instanceof Controller)) {
        return new Controller(deviceName);
    }

    self.status = {
        raw : {
            R : 0
        },
        computed : {
            temperature : 22
        }
    };

    try {
        self.history = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'data', 'history.json'),
            'utf8'
        ));
    } catch (err) {
        self.history = [];
    }

    self.port = new serial.SerialPort(deviceName, {
        baudRate : 115200,
        parser   : serial.parsers.readline('\n')
    });

    self.port.on('open', self._onPortOpen.bind(self));
    self.port.on('data', self._onPortData.bind(self));

    self._isFirstLine = true;

    self.setpoint = 0;

    self.Kp = 400,
    self.Ki = 100,
    self.Kd = 30;

    self.pid = new PID(
        self.status.computed.temperature,
        self.setpoint,
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

Controller.prototype.setTargetTemperature = function(temp, cb) {
    var self = this;

    self.setpoint = temp;
    self.pid.setPoint(temp);
    self.pid.setOutputLimits(temp - 10, temp + 10);
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

Controller.prototype.close = function(cb) {
    var self = this;

    clearInterval(self.pidIntervalHandle);
    self.pidIntervalHandle = null;

    fs.writeFile(
        path.join(__dirname, '..', 'data', 'history.json'),
        JSON.stringify(self.history),
        function(err) {
            if (err) {
                self.emit('log', 'Error saving history: ' + err.message);
            }
            self.port.close(function(err) {
                cb(err);
            });
        }
    );
};

Controller.prototype._pidStep = function() {
    var self = this;

    var currentTemp = self.status.computed.temperature;

    self.pid.setInput(currentTemp);
    self.pid.compute();

    if (self.setpoint <= 0) {
        if (self.status.raw.R) {
            self.disableRelays();
        }
        return;
    }

    self.history.push({
        timestamp   : +new Date,
        temperature : currentTemp,
        target      : self.setpoint
    });
    while (self.history.length > 4000) {
        self.history.shift();
    }

    var output = self.pid.getOutput(),
        enable = (output > self.setpoint);

    if (enable) {
        self.enableRelays();
    } else {
        self.disableRelays();
    }

    self.emit('log', util.format(
        'temp=%d setpoint=%d PID=%d relays=%s',
        currentTemp,
        self.setpoint,
        output,
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
        }
    }
};

module.exports = Controller;
