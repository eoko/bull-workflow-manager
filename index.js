require('dotenv').config();

const yaml = require('js-yaml');
const {promisify} = require('util');
const fs = require('fs');
const queue = require('./src/queue');

let workflowsDirectory = null;
let jobsDirectory = null;

/**
 * Init
 */
module.exports.init = (config) => {
	readConfiguration(config);
	queue.init(jobsDirectory, config);
};

/**
 * Register hook
 * @return {Promise.<void>}
 * @param workflowId
 * @param data
 */
module.exports.register = async(workflowId, data) => {

	const workflowConfigFiles = await analyzeWorkflow(workflowsDirectory);

	for(const i in workflowConfigFiles) {
		try {
			if(workflowId === workflowConfigFiles[i].id) {
				checkRequirements(workflowConfigFiles[i], data);

				for (const j in workflowConfigFiles[i].stages) {
					queue.add(workflowConfigFiles[i].stages[j], data);
				}
			}
		} catch(e) {
			console.log(e.message);
		}
	}
};

/**
 * @param directory
 * @returns {Promise.<Array>}
 */
async function analyzeWorkflow(directory) {
	const workflows = await promisify(fs.readdir)(directory);
	let configFiles = [];

	for(const i in workflows) {
		try {
			if(fs.existsSync(`${directory}${workflows[i]}/workflow.yml`)) {
				configFiles.push(yaml.safeLoad(fs.readFileSync(`${directory}${workflows[i]}/workflow.yml`, 'utf8')));
			} else {
				configFiles = configFiles.concat(await analyzeWorkflow(`${directory}${workflows[i]}/`));
			}
		} catch(e) {
			console.log(e.message);
		}
	}

	return configFiles;
}

/**
 * @param doc
 * @param data
 */
function checkRequirements(doc, data) {
	const requirements = doc.requirements;

	if(!requirements) {
		return true;
	}

	if(requirements.data) {
		for(const i in requirements.data) {
			if(data) {
				Object.keys(requirements.data[i]).map((key) => {

					const dataCompare = getDataCompareFromKey(key, data);
					const typeAcceptedForCompare = ['string', 'number', 'boolean'];

					if(typeAcceptedForCompare.indexOf(typeof(requirements.data[i][key])) !== -1) {
						if(dataCompare !== requirements.data[i][key]) {
							throw new Error(`[${doc.name}] Requirements not completed : Require ${requirements.data[i][key]} ; Give ${dataCompare}`);
						}
					} else if(Array.isArray(requirements.data[i][key])) {
						if(requirements.data[i][key].indexOf(dataCompare) === -1) {
							throw new Error(`[${doc.name}] Requirements not completed : Require ${requirements.data[i][key]} ; Give ${dataCompare}`);
						}
					} else {
						console.log(`Type not recognized : ${typeof(requirements.data[i][key])}`);
					}

				});
			} else {
				throw new Error(`[${doc.name}] Requirements not completed : no data given`);
			}
		}
	}
}

/**
 * Get data according to key
 * @param key
 * @param data
 * @return {*}
 */
function getDataCompareFromKey(key, data) {
	let dataCompare = data;

	if(key.indexOf('.') !== -1) {
		const arrayKeys = key.split('.');
		for(const j in arrayKeys) {
			if(dataCompare.hasOwnProperty(arrayKeys[j])) {
				dataCompare = dataCompare[arrayKeys[j]];
			}
		}
	} else {
		if(dataCompare.hasOwnProperty(key)) {
			dataCompare = dataCompare[key];
		}
	}

	return dataCompare;
}

/**
 * Read config
 * @param config
 */
function readConfiguration(config) {
	if (config && config.workflows_directory) {
		workflowsDirectory = config.workflows_directory;
	} else {
		workflowsDirectory = process.env.WORKFLOWS_DIRECTORY;
	}

	if (config && config.jobs_directory) {
		jobsDirectory = config.jobs_directory;
	} else {
		jobsDirectory = process.env.JOBS_DIRECTORY;
	}

	if(!workflowsDirectory) {
		throw new Error('Workflows directory missing');
	}

	if(!jobsDirectory) {
		throw new Error('Jobs directory missing');
	}

	if(workflowsDirectory.substr(workflowsDirectory.length -1) !== '/') {
		workflowsDirectory = `${workflowsDirectory}/`;
	}

	if(jobsDirectory.substr(jobsDirectory.length -1) !== '/') {
		jobsDirectory = `${jobsDirectory}/`;
	}
}
