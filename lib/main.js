'use strict';
module.exports.init = function(worker_creation, config) {
  if (!config || typeof config !== 'object') throw 'You must set a config object';
  if (!config.cluster || typeof config.cluster !== 'object') throw 'You must set a cluster config object';
  if (!worker_creation || typeof worker_creation !== 'function') throw 'You must set a worker_creation function';
  if (config.cluster.activated) {
      // The "api" dependency is passed in as "Api"
      // Again, the other dependencies passed in are not "AMD" therefore don't pass
      // a parameter to this function
    var cluster = require('cluster');
    var num_workers = config.cluster.num_workers || 4;

    // Master
    if (cluster.isMaster) {
      // In real life, you'd probably use more than just 2 workers,
      // and perhaps not put the master and worker in the same file.
      //
      // You can also of course get a bit fancier about logging, and
      // implement whatever custom logic you need to prevent DoS
      // attacks and other bad behavior.
      //
      // See the options in the cluster documentation.
      //
      // The important thing is that the master does very little,
      // increasing our resilience to unexpected errors.
       
      var activeWorkers = 0;

      // Fork workers.
      cluster.on('fork', function (worker) {
        console.log('Starting worker ', worker.id, new Date().toISOString());
        activeWorkers++;
      });

      cluster.on('exit', function (worker, code, signal) {
        console.error('Exit worker: ', worker.id);
      });

      cluster.on('disconnect', function (worker) {
        activeWorkers--;
        if (activeWorkers <= num_workers) cluster.fork();
      });

      for (var i = 0; i < num_workers; i++) {
        cluster.fork();
      }

      var endMaster = function (signal) {
        console.log('Finishing master...');
        cluster.disconnect(function () {
          console.log('All workers disconnected. End master');
          process.kill(process.pid, signal);
        });
      };

      process.on('SIGTERM', function () {
        endMaster('SIGTERM');
      });

      process.once('SIGUSR2', function () {
        endMaster('SIGUSR2');
      });

      process.on('exit', function () {
        endMaster('SIGTERM');
      });

    }
    // Worker
    else worker_creation(cluster.worker);
  }
  else worker_creation();  
};