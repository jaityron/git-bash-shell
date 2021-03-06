"use strict";
const getEnvValue = require("./get-env-value");
const rawEnv = require("./env-value");
const stdio = require("./stdio");
const which = require("./which");
const gitWin = require("git-win");
const path = require("path");
const ChildProcess = require("child_process").ChildProcess;

const envExec = which("/usr/bin/env");
const windir = getEnvValue("SystemRoot");
const rootDir = path.join(__dirname, "..");
const binDir = path.join(rootDir, "bin");

function isLifecycleScript (args, options) {
	const script = getEnvValue("npm_lifecycle_script", options);
	return script && script === args;
}

function isWinExec (file) {
	if (/\.(?:cmd|bat)$/.test(file)) {
		return true;
	}
	if (/[A-Z]:\\Windows(?=\\|$)/i.test(file) || (file.startsWith(windir + "\\"))) {
		if (/(?:^|\\)(?:(?:[bd]a|z)?sh|curl|tar)(?:\.exe)?$/i.test(file) || /(?:^|\\)OpenSSH(?=\\|$)/i.test(file)) {
			return false;
		}
		return true;
	}
	return false;
}

function fixShellArgs (options, file) {
	if (options.windowsVerbatimArguments && options.args.length >= 3 && options.args.slice(1, -1).every(arg => /^\/\w(?:\s+\/\w)*$/.test(arg))) {
		let args = options.args[options.args.length - 1];
		if (/^".*"$/.test(args)) {
			args = args.slice(1, -1);
		}
		let argv0;

		if (gitWin.fixPosixRoot(file)) {
			argv0 = options.args[0];
			if (/^SET(?=\s|$)/.test(args) && isLifecycleScript(args, options)) {
				args = "env" + args.slice(3);
			}
		} else if (
			[
				/^\$/,
				/^\w+\S*=/,
				/^(?:env|(?:[bd]a|z)?sh)(?=\s|$)/,
				/^\/(?:bin|dev|etc|mingw\d+|proc|tmp|usr)(?=\/|$)/,
				/\[.*?\]/,
				/\$\{.*?\}/,
				/\$\(.*?\)/,
			].some(regexp => regexp.test(args)) && isLifecycleScript(args, options)
		) {
			const shell = getEnvValue("SHELL", options);
			if (/^(?:(?:(?:\/usr)?\/bin\/)?env(?:\s+-\S*)*\s+)?(?:\w+\S+=\S*\s+)*?SHELL=(\S+)(?=\s|$)/.test(args) || /^((?:(?:\/usr)?\/bin\/)?\w+)(?:\s+-\S+)*?\s+-c(?=\s|$)/.test(args)) {
				argv0 = RegExp.$1;
				if (shell && argv0 !== shell) {
					options.envPairs.some((env, i) => {
						if (env.startsWith("SHELL=")) {
							options.envPairs[i] = "SHELL=" + argv0;
							return true;
						}
					});
				}
			} else {
				argv0 = shell || "/bin/sh";
			}
			file = which(argv0, options) || argv0;

			if (!shell) {
				options.envPairs.push("SHELL=" + argv0);
			}
		} else {
			options.envPairs.some((env, i) => {
				if (/^Path=/i.test(env)) {
					const Path = env.slice(5).split(/;+/g);
					const npmBinIndex = Path.findIndex(dir => /(?:^|[\\/])node_modules[\\/].bin$/.test(dir));
					if (npmBinIndex >= 0) {
						Path.splice(npmBinIndex, 0, binDir);
					}
					env = env.slice(0, 5) + Array.from(new Set(Path)).join(";");
					options.envPairs[i] = env;
				}
			});
			return;
		}
		options.args = [argv0, "-c", args];
		options.file = file;

		delete options.windowsVerbatimArguments;
		return options;
	}
}

function fixSpawnArgs (options) {
	options.envPairs.some((env, i) => {
		if (/^ComSpec=/i.test(env)) {
			options.envPairs[i] = env.slice(0, 8) + rawEnv.ComSpec;
			return true;
		}
	});

	const file = which(options.file, options);

	if (!file || file === envExec) {
		return;
	}

	if (file === process.execPath) {
		if (options.args.indexOf(rootDir) < 0) {
			options.args.unshift(
				options.args.shift(),
				"--require",
				rootDir
			);
		}
		return;
	}

	if (fixShellArgs(options, file)) {
		return;
	}

	let result;

	if (/\.(?:exe|cmd|bat|com)$/.test(file)) {
		if (isWinExec(file)) {
			const argv0 = path.normalize(options.args[0]);
			options.args[0] = argv0.replace(/^~(?=[/\\]|$)/, () => (
				file.slice(0, file.indexOf(argv0.slice(1)))
			));
			result = true;
		}
	} else {
		options.file = envExec;
		options.args.unshift("/usr/bin/env");
		return;
	}
	options.file = file;
	return result || false;
}

function fixSpawn (oldFn, args) {
	const isWinExec = fixSpawnArgs.apply(this, args);
	const result = oldFn.apply(this, args);
	if ((isWinExec || args[0].windowsVerbatimArguments) && !/(^|\\|\/)cmd(?:\.exe)?$/i.test(args[0].file)) {
		stdio.apply(this instanceof ChildProcess ? this : result, args);
	}
	return result;
}

module.exports = fixSpawn;
