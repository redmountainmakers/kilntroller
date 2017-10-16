var events = require('events'),
    moment = require('moment'),
    util   = require('util');

function Scheduler(settings, controller) {
    var self = this;

    if (!(self instanceof Scheduler)) {
        return new Scheduler(settings, controller);
    }

    self.settings   = settings;
    self.controller = controller;
    self.schedule   = null;
    self.status     = null;

    self.sendUpdate();
}

util.inherits(Scheduler, events.EventEmitter);

Scheduler.prototype.getStatus = function() {
    var self = this;

    if (self.schedule) {
        return {
            steps : {
                previous : self.schedule.slice(0, self.status.stepIndex),
                current  : self.schedule[self.status.stepIndex] || null,
                future   : self.schedule.slice(self.status.stepIndex + 1),
            },
            startedAt     : self.status.startedAt,
            stepStartedAt : self.status.stepStartedAt,
            timestamp     : +moment.utc()
        };
    } else {
        return {
            steps : {
                previous : [],
                current  : null,
                future   : [],
            },
            startedAt     : 0,
            stepStartedAt : 0,
            timestamp     : +moment.utc(),
        };
    }
};

Scheduler.prototype.setSchedule = function(schedule) {
    var self = this;

    schedule = self.validateSchedule(schedule);

    if (self.schedule) {
        self.clearSchedule(false);
    }

    self.schedule = schedule;
    self.status = {
        startedAt     : +moment.utc(),
        stepIndex     : 0,
        stepStartedAt : +moment.utc(),
        interval      : setInterval(self.update.bind(self), 1000)
    };
    self.update();
};

Scheduler.prototype.update = function() {
    var self = this;

    var desiredTemperature = null,
        step               = self.schedule[self.status.stepIndex],
        minutesThisStep    = (moment.utc() - self.status.stepStartedAt) / 1000 / 60;

    if (minutesThisStep < step.rampMinutes) {
        // Ramp
        var startTemperature = step.rampStartTemperature;
        desiredTemperature = (
            startTemperature +
            (step.temperature - startTemperature) * (minutesThisStep / step.rampMinutes)
        );
    } else if (minutesThisStep < step.rampMinutes + step.soakMinutes) {
        // Soak
        desiredTemperature = step.temperature;
    } else {
        // End of this step
        if (self.status.stepIndex === self.schedule.length - 1) {
            // This is the end of the schedule
            self.controller.setTargetTemperature(0);
            // Send an update with all steps in the 'previous' bucket
            self.status.stepIndex++;
            self.sendUpdate();
            // Clear the schedule and return
            self.clearSchedule(false);
            return;
        } else {
            // Advance to the next step
            self.status.stepIndex++;
            self.status.stepStartedAt = +moment.utc();
            self.update();
        }
    }

    if (desiredTemperature !== null) {
        var currentTemperature = self.controller.getTargetTemperature();
        if (currentTemperature !== desiredTemperature) {
            self.controller.setTargetTemperature(desiredTemperature);
        }
    }

    self.sendUpdate();
};

Scheduler.prototype.sendUpdate = function() {
    var self = this;

    self.emit('update', self.getStatus());
};

Scheduler.prototype.clearSchedule = function(sendUpdate) {
    var self = this;

    if (self.schedule) {
        self.schedule = null;
        clearInterval(self.status.interval);
        self.controller.setTargetTemperature(0);
        self.status = null;
    }

    if (sendUpdate !== false) {
        self.sendUpdate();
    }
};

Scheduler.prototype.validateSchedule = function(schedule) {
    var self = this;

    schedule = JSON.parse(JSON.stringify(schedule));

    if (!Array.isArray(schedule)) {
        throw new Error('Schedule must be an array');
    }

    if (!schedule.length) {
        throw new Error('Schedule must have at least one step');
    }

    schedule.forEach(function(step) {
        if (
            typeof step.temperature !== 'number' ||
            step.temperature < self.settings.minTemperature ||
            step.temperature > self.settings.maxTemperature
        ) {
            throw new Error(util.format(
                'Step temperature must be a number between %d and %d',
                self.settings.minTemperature,
                self.settings.maxTemperature
            ));
        }

        if (typeof step.rampMinutes === 'undefined') {
            step.rampMinutes = 0;
        }
        if (
            typeof step.rampMinutes !== 'number' ||
            step.rampMinutes < 0
        ) {
            throw new Error('Step ramp time must be a non-negative number');
        }

        if (typeof step.soakMinutes === 'undefined') {
            step.soakMinutes = 0;
        }
        if (
            typeof step.soakMinutes !== 'number' ||
            step.soakMinutes < 0
        ) {
            throw new Error('Step soak time must be a non-negative number');
        }

        step.rampMinutes = Math.round(step.rampMinutes);
        step.soakMinutes = Math.round(step.soakMinutes);

        if (step.rampMinutes === 0 && step.soakMinutes === 0) {
            throw new Error('Step ramp and soak times cannot both be zero');
        }

        if (step.rampMinutes > 0) {
            if (typeof step.rampStartTemperature === 'undefined') {
                step.rampStartTemperature = self.settings.minTemperature;
            }

            if (
                typeof step.rampStartTemperature !== 'number' ||
                step.rampStartTemperature < self.settings.minTemperature ||
                step.rampStartTemperature > self.settings.maxTemperature
            ) {
                throw new Error(util.format(
                    'Step temperature must be a number between %d and %d',
                    self.settings.minTemperature,
                    self.settings.maxTemperature
                ));
            }
        } else {
            delete step.rampStartTemperature;
        }
    });

    return schedule;
};

module.exports = Scheduler;
