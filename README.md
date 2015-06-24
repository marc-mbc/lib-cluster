<h1>Cluster</h1>
<p>This is a cluster library for nodejs services</p>

<p>In order to init the module it's needed an instance Constructor for the service (worker), a config instance with cluster config and bunyan instance as a log.</p>
<p>Example: require('lib-cluster').init(Api, config, log); </p>

<p>The cluster is ready to perform actions when receive some signals:</p>
<ul>
	<li>SIGTERM, SIGINT, SIGWINCH: stop all worker gracefully and exit</li>
	<li>SIGUSR2: respawn all workers gracefully without downtime</li>
	<li>SIGTTIN: Adds a new worker </li>
	<li>SIGTTOU: Removes a worker gracefully</li>
</ul>
