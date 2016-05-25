var events = require('events'),
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

    self.port = new serial.SerialPort(deviceName, {
        baudRate : 115200,
        parser   : serial.parsers.readline('\n')
    });

    self.port.on('open', self._onPortOpen.bind(self));
    self.port.on('data', self._onPortData.bind(self));

    self._isFirstLine = true;
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

Controller.prototype.getStatus = function() {
    var self = this;

    return self.status;
};

Controller.prototype.close = function(cb) {
    var self = this;

    self.port.close(function(err) {
        cb(err);
    });
};

Controller.prototype._sendCommand = function(command, cb) {
    var self = this;

    self.port.write(command + '\r\n', function(err) {
        cb(err);
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
