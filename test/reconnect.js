/* jslint node: true */
/* global describe: false, before: false, after: false, it: false */
'use strict';

var NATS = require ('../'),
    nsc = require('./support/nats_server_control'),
    should = require('should');

describe('Reconnect functionality', function() {

  var PORT = 1426;
  var WAIT = 20;
  var ATTEMPTS = 4;
  var server;

  // Start up our own nats-server
  before(function(done) {
    server = nsc.start_server(PORT, done);
  });

  // Shutdown our server after we are done
  after(function() {
    server.kill();
  });

  it('should not emit a reconnecting event if suppressed', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnect':false});
    should.exist(nc);
    nc.on('connect', function() {
      server.kill();
    });
    nc.on('reconnecting', function(/*client*/) {
      done(new Error('Reconnecting improperly called'));
    });
    nc.on('close', function() {
      nc.close();
      server = nsc.start_server(PORT, done);
    });
  });

  it('should emit a disconnect and a reconnecting event after proper delay', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnectTimeWait':WAIT});
    var startTime;
    should.exist(nc);
    nc.on('connect', function() {
      server.kill();
      startTime = new Date();
    });
    nc.on('reconnecting', function(/*client*/) {
      var elapsed = new Date() - startTime;
      elapsed.should.be.within(WAIT, 5*WAIT);
      nc.close();
      server = nsc.start_server(PORT, done);
    });
    nc.on('disconnect', function() {
      var elapsed = new Date() - startTime;
      elapsed.should.be.within(0, 5*WAIT);
    });
  });

  it('should emit multiple reconnecting events and fail after maxReconnectAttempts', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnectTimeWait':WAIT, 'maxReconnectAttempts':ATTEMPTS});
    var startTime;
    var numAttempts = 0;
    nc.on('connect', function() {
      server.kill();
      startTime = new Date();
    });
    nc.on('reconnecting', function(/*client*/) {
      var elapsed = new Date() - startTime;
      elapsed.should.be.within(WAIT, 5*WAIT);
      startTime = new Date();
      numAttempts += 1;
    });
    nc.on('close', function() {
      numAttempts.should.equal(ATTEMPTS);
      nc.close();
      server = nsc.start_server(PORT, done);
    });
  });

  it('should succesfully reconnect to new server', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnectTimeWait':100});
    // Kill server after first successful contact
    nc.flush(function() {
      server.kill();
      server = null;
    });
    nc.on('reconnecting', function(/*client*/) {
      // restart server and make sure next flush works ok
      if (server === null) {
        server = nsc.start_server(PORT);
      }
    });
    nc.on('reconnect', function() {
      nc.flush(function() {
        nc.close();
        done();
      });
    });
  });

  it('should succesfully reconnect to new server with subscriptions', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnectTimeWait':100});
    // Kill server after first successful contact
    nc.flush(function() {
      server.kill();
      server = null;
    });
    nc.subscribe('foo', function() {
      nc.close();
      done();
    });
    nc.on('reconnecting', function(/*client*/) {
      // restart server and make sure next flush works ok
      if (server === null) {
        server = nsc.start_server(PORT);
      }
    });
    nc.on('reconnect', function() {
      nc.publish('foo');
    });
  });

  it('should succesfully reconnect to new server with queue subscriptions correctly', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnectTimeWait':100});
    // Kill server after first successful contact
    nc.flush(function() {
      server.kill();
      server = null;
    });
    var received = 0;
    // Multiple subscribers
    var cb = function cb() { received += 1; };
    for (var i=0; i<5; i++) {
      nc.subscribe('foo', {'queue':'myReconnectQueue'}, cb);
    }
    nc.on('reconnecting', function(/*client*/) {
      // restart server and make sure next flush works ok
      if (server === null) {
        server = nsc.start_server(PORT);
      }
    });
    nc.on('reconnect', function() {
      nc.publish('foo', function() {
	received.should.equal(1);
	nc.close();
	done();
      });
    });
  });

  it('should properly resync with inbound buffer non-nil', function(done) {
    var nc = NATS.connect({'port':PORT, 'reconnectTimeWait':100});

    // Send lots of data to ourselves
    nc.on('connect', function() {
      var sid = nc.subscribe('foo', function() {
	// Kill server on first message, inbound should still be full.
	server.kill();
	nc.unsubscribe(sid);
        server = nsc.start_server(PORT);
      });
      var b = new Buffer(4096).toString();
      for (var i=0; i<1000; i++) {
        nc.publish('foo', b);
      }
    });

    nc.on('reconnect', function() {
      nc.flush(function() {
	nc.close();
	done();
      });
    });
  });

});