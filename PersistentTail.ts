import {Tail} from 'tail';

import * as hound from 'ts-hound';
import path from 'path';
import _ from 'lodash';
import process from 'process';

const tailErrorHandler = process.on('uncaughtException', (error ) => {
	if (error.message.indexOf('ENOENT') !== -1) {
		// don't rethrow this error we expect files to stop existing which causes Tail to crash throwing
		// this error. 
		console.warn(error); 
	} else {
		throw error;
	}
});

export class PersistentTail {
	listeningFns: ((s: string) => void)[];
	tail: Tail | undefined;
	watcher: hound.Hound;
	basename: string;
	dirname: string;
	constructor(filename: string) {
		this.listeningFns = [];
		this.dirname = path.dirname(filename);
		this.basename = path.basename(filename);
		this.watcher = hound.watch(this.dirname);
		this.watcher.on('create', (filename) => {
			if (path.basename(filename) === this.basename) {
				this.tail = this.recreateTail(filename);
			}
		});
		try {
			this.tail = this.recreateTail(filename);
		} catch(error) {
			console.error(error);
		}
	}

	private recreateTail(filename: string) {
		try {
			const tail = new Tail(filename, {fromBeginning: true, follow: true, useWatchFile: true});
			tail.on('error', (error) => {
				console.error(error);
			});
			tail.on('line', (line) => {
				_.forEach(this.listeningFns, fn => {
					fn(line);
				});
			});
			return tail;
		} catch(error) {
			return undefined;
		}
	}

	on (input: (s:string) => void) {
		this.listeningFns.push(input);
	}
}