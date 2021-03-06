require('dotenv').config();

const Queue = require('bull');
const {promisify} = require('util');
const fs = require('fs');
const Stage = require('./Stage');

let stageOnSuccess = [];
let stageOnFail = [];
let queue = null;

/**
 * Initialize main queue + process all jobs
 */
module.exports.init = (jobsDirectory, config) => {

	let redisHost = process.env.REDIS_HOST || config['redis_host'];
	let redisPort = process.env.REDIS_PORT || config['redis_port'];

	if(!redisHost) {
		console.warn('Missing environnement REDIS_HOST, default used (127.0.0.1)');
		redisHost = '127.0.0.1';
	}

	if(!redisPort) {
		console.warn('Missing environnement REDIS_PORT, default used (6379)');
		redisPort = 6379;
	}

	queue = new Queue(this.getQueueName(), `redis://${redisHost}:${redisPort}`);
	queue.empty();

	processJobs(jobsDirectory, '', config);

	queue.on('completed', (job, result) => {
		addChildToQueue(stageOnSuccess, job, result);
	});

	queue.on('failed', (job, err) => {
		addChildToQueue(stageOnFail, job, err);
	});

	return queue;
};

/**
 * Return name of queue
 * @return {*|string}
 */
module.exports.getQueueName = () => {
	return process.env.QUEUE_NAME || 'global-jobs';
};

/**
 * Add job to queue
 * @param confParent
 * @param data
 */
module.exports.processStages = (confParent) => {
	const stages = [];
	for (const stagePosition in confParent.stages) {
		const name = Object.keys(confParent.stages[stagePosition])[0];
		const stageConfig = confParent.stages[stagePosition][name];
		stages.push(new Stage(stageConfig, name));
		// addStage(new Stage(stageConfig, name), data, null, confParent);
	}
	return stages;
};

/**
 * Add all stage for one workflow
 * @param stages
 * @param data
 * @param confParent
 */
module.exports.addStages = (stages, data, confParent) => {
	for(const i in stages) {
		addStage(stages[i], data, null, confParent);
	}
};

/**
 * @param stage
 * @param data
 * @param previous
 * @param confParent
 */
function addStage(stage, data, previous, confParent) {
	console.log(`[${confParent.name}] Stage(${stage.getName()}) :: Add job(${stage.getJob()})`);
	queue.add(
		stage.getJob(),
		{
			'body': data,
			'previous': previous,
			'workflow': {
				'config': {
					'name': confParent.name,
					'description': confParent.description,
					'id': confParent.id
				},
				'stage': {
					'name': stage.getName()
				},
				'data': stage.getData()
			}
		},
		{
			stageId: stage.getId(),
			priority: stage.getPriority(),
			repeat: stage.getRepeat()
		}
	);

	addChildJob(stage, confParent, data);
}

/**
 * Process all jobs
 * @param dir
 * @param prefix
 * @param config
 */
function processJobs(dir, prefix, config) {
	promisify(fs.readdir)(dir)
		.then((dirList) => {
			dirList.map((value) => {
				let _prefix = prefix;
				const file = fs.statSync(dir+value);

				if(file.isDirectory()) {
					processJobs(`${dir}${value}/`, `${prefix}${value}/`, config);
				}
				else {
					if(config && config.fromDependencies) {
						_prefix = `$${config.name}/${_prefix}`;
					}

					console.log(`Job processed : ${_prefix}${value.substring(0, value.length - 3)}`);
					queue.process(_prefix+value.substring(0, value.length - 3), require(`${dir}${value}`));
				}
			});
		});
}

/**
 * Add child job to queue
 * @param stages
 * @param job
 * @param data
 */
function addChildToQueue(stages, job, data) {
	for (const i in stages) {
		if(job.opts.stageId && stages[i].parent.getId() === job.opts.stageId) {
			addStage(stages[i].child, stages[i].data, data, stages[i].confParent);
			stages.splice(i, 1);
		}
	}
}

/**
 * @param stage
 * @param confParent
 * @param data
 */
function addChildJob(stage, confParent, data) {
	if(stage.getOnSuccess() !== null) {
		stageOnSuccess.push(Object.assign(stage.getOnSuccess(), {
			'data': data,
			'confParent': confParent
		}));
	}

	if(stage.getOnFail() !== null) {
		stageOnFail.push(Object.assign(stage.getOnFail(), {
			'data': data,
			'confParent': confParent
		}));
	}
}