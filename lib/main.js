'use strict';
module.exports.init = function(worker_creation, config, log) {
  try {
    if (!config || typeof config !== 'object') throw new Error('You must set a config object');
    if (!config.cluster || typeof config.cluster !== 'object') throw new Error('You must set a cluster config object');
    if (!worker_creation || typeof worker_creation !== 'function') 
      throw new Error('You must set a worker_creation function');
    if (!log || typeof log !== 'object') throw new Error('You must set a log object (bunyan)');
  }
  catch(err) {
    console.error(err);
    setTimeout(process.exit, 100);
  }
  // Go through all workers
  if (config.cluster.activated) {
      // The "api" dependency is passed in as "Api"
      // Again, the other dependencies passed in are not "AMD" therefore don't pass
      // a parameter to this function
    var cluster = require('cluster');
    var workersExpected = 0;
    var stopping_workers = {};
    var max_stopping_workers = 100;
    var config_worker = config.cluster.num_workers || 4;

    // Master
    if (cluster.isMaster) {
      try {
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
         
        var workerRestartArray = [];

        var setupShutdown = function(){   
          log.info('Cluster manager quitting');   
          log.info('Stopping each worker...');   
          for (var id in cluster.workers) {
            if (cluster.workers.hasOwnProperty(id) && !stopping_workers[id]) {    
              cluster.workers[id].send('shutdown');
            }  
          }   
          setTimeout(loopUntilNoWorkers, 1000); 
        }; 
       
        var loopUntilNoWorkers = function(){  
          if(cluster.workers.length > 0){
            log.info('There are still ' + cluster.workers.length + ' workers...');
            setTimeout(loopUntilNoWorkers, 1000);
          }
          else {
            log.info('All workers gone, Finishing');
            setTimeout(process.exit, 500);
          }
        };

        var reloadAWorker = function(){
          var count = 0;
          var worker;
          for (var id in cluster.workers){ 
            if (cluster.workers.hasOwnProperty(id) && !stopping_workers[id]) {    
              count++;
            }
          }

          if (workersExpected > count){
            startAWorker();
          }
          if (workerRestartArray.length > 0){
            worker = workerRestartArray.pop();
            worker.send('shutdown');
          }
        };

        var stop_stopping_workers = function () {
          var target_id;
          var oldest;
          for (var id in stopping_workers){ 
            if (stopping_workers.hasOwnProperty(id)) {    
              if (!target_id) {
                target_id = id;
                oldest = stopping_workers[id];
              }
              else if (oldest > stopping_workers[id]) {
                target_id = id;
                oldest = stopping_workers[id];
              }
            }
          }
          clearTimeout(timeouts[target_id]);
          delete stopping_workers[target_id];
          cluster.workers[target_id].kill();
        };

        var timeouts = {};

        var startAWorker = function () {  
          var worker = cluster.fork();  
          log.info('Starting worker #' + worker.id);
          worker.on('message', function(message) {     
            if(worker.state != 'none') {       
              log.info('Message [' + worker.process.pid + ']: ' + message);
            }
            if (message == 'Stopped') {
              clearTimeout(timeouts[worker.id]);
              if (stopping_workers[worker.id]) delete stopping_workers[worker.id];
              worker.kill();
            }
            else if (message == 'Stopping' || message == 'Error') {
              setTimeout(function () {
                reloadAWorker();
              }, 1000); // to prevent CPU-splsions if crashing too fast

              // to prevent that a disconnected worker never die
              timeouts[worker.id] = setTimeout(function () {
                log.warn('Worker [' + worker.process.pid + '] (#' + worker.id + 
                  ') does not stop on time, so we force stop');
                if (stopping_workers[worker.id]) delete stopping_workers[worker.id];
                worker.kill();
              }, 180000);
              
              // Check if we have to many stopping workers
              stopping_workers[worker.id] = new Date().getTime();
              // To many stopping worker, will the oldest
              if (max_stopping_workers < Object.keys(stopping_workers).length) {
                stop_stopping_workers();
              }
            }  
          });
        };

        process.on('SIGTERM', function() { 
          log.info('Signal: SIGTERM');   
          workersExpected = 0;  
          setupShutdown(); 
        });

        process.on('SIGINT', function(){  
          log.info('Signal: SIGINT');   
          workersExpected = 0;  
          setupShutdown(); 
        });
        
        /*process.on('SIGKILL', function(){  
          log.info('Signal: SIGKILL');   
         workersExpected = 0;  
         setupShutdown(); 
        });*/

        process.on('SIGUSR2', function(){  
          log.info('Signal: SIGUSR2');   
          log.info('Swap out new workers one-by-one');   
          workerRestartArray = []; 
          for(var id in cluster.workers){   
            if (cluster.workers.hasOwnProperty(id) && !stopping_workers[id]) {    
              workerRestartArray.push(cluster.workers[id]);  
            } 
          }
          workerRestartArray.reverse();   
          reloadAWorker(); 
        });

        process.on('SIGWINCH', function(){
          log.info('Signal: SIGWINCH');
          log.info('Stop all workers');
          workersExpected = 0;
          for (var id in cluster.workers) {
            if (cluster.workers.hasOwnProperty(id) && !stopping_workers[id]) {    
              cluster.workers[id].send('shutdown');
            }
          }
        });

        process.on('SIGTTIN', function(){
          log.info('Signal: SIGTTIN');
          log.info('Add a worker');
          workersExpected++;
          startAWorker();
        });

        process.on('SIGTTOU', function(){
          log.info('Signal: SIGTTOU');
          log.info('Remove a worker');
          workersExpected--;
          for (var id in cluster.workers) {
            if (cluster.workers.hasOwnProperty(id) && !stopping_workers[id]) {    
              cluster.workers[id].send('shutdown');
              break;
            }
          }
        });

        process.on('exit', function(){  
          workersExpected = 0;  
          log.info('Cluster ready to close, See you!'); 
        });

        for (var i = 0; i < config_worker; i++) {
          workersExpected++;
          startAWorker();
        }

        cluster.on('fork', function(worker) {
          log.info('worker ' + worker.process.pid + ' (#' + worker.id + ') has spawned');
        });

        cluster.on('exit', function(worker, code, signal) {
          log.info('Worker ' + worker.process.pid + ' (#' + worker.id + ') has exited');
        });
      }
      catch (err) {
        log.fatal('Cluster error:', err);
        workersExpected = 0;  
        setupShutdown(); 
      }
    }
    // Worker
    else worker_creation(cluster.worker);
  }
  else worker_creation();  
};