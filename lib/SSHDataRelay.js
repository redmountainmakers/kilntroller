var cp     = require('child_process'),
    events = require('events'),
    split  = require('split'),
    util   = require('util');

function SSHDataRelay(settings, controller) {
    var self = this;

    if (!(self instanceof SSHDataRelay)) {
        return new SSHDataRelay(settings, controller);
    }

    self.controller = controller;
    self.settings   = settings;

    self._boundRecord = self.record.bind(self);

    self.connect();
}

util.inherits(SSHDataRelay, events.EventEmitter);

SSHDataRelay.prototype.connect = function() {
    var self = this;

    var args = [];
    args.push('-i');
    args.push(self.settings.identityFile);
    args.push(self.settings.user + '@' + self.settings.hostname);
    args.push(self.settings.nodePath || 'node');
    args.push(self.settings.intakePath);

    self.worker = cp.spawn('ssh', args);

    self.worker.stdout.pipe(split())
        .on('data', function(line) {
            if (line === 'ready') {
                self.controller.on('update', self._boundRecord);
            }
            if (line) {
                self.emit('log', 'ssh: ' + line);
            }
        });

    self.worker.stderr.pipe(split())
        .on('data', function(line) {
            if (line) {
                self.emit('log', 'ssh stderr: ' + line);
            }
        });

    self.worker.on('close', function() {
        self.emit('log', 'ssh process closed');
        self.worker = null;
        self.controller.removeListener('update', self._boundRecord);
    });
};

SSHDataRelay.prototype.close = function(cb) {
    var self = this;

    if (self.worker) {
        self.worker.kill();
    }
};

SSHDataRelay.prototype.record = function(status) {
    var self = this;

    if (self.worker) {
        try {
            self.worker.stdin.write(JSON.stringify(status) + "\n");
        } catch (err) {
            // This might fail if the process is closing
        }
    }
};

module.exports = SSHDataRelay;
