import {Tail} from 'tail';

import * as hound from 'ts-hound';
import path from 'path';
import _ from 'lodash';
import process from 'process';
import {type} from "node:os";

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

export type CsvLine = Map<string, number>;
export type CsvLineHandler = ((slot: number, line: CsvLine) => void);

export class PersistentTurnGroup {
	listeningFns: CsvLineHandler[];
	tail: Tail | undefined;
	watcher: hound.Hound;
	basename: string;
	dirname: string;
	columns: string[] = [];
	lastTurn: number = 0;
	recentTurns: CsvLine[] = [];
	players: number = 0;
	static TURN_COLUMN: string = 'Game Turn';

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
			tail.on('line', (line: string) => {
				if(!this.columns) {
					let prefix = "";
					this.columns = line.split(',').map((elem) => {
						let strs = elem.split(': ');
						if(strs.length > 1) {
							prefix = strs[0];
						}
						return prefix + strs[1];
					});
				} else {
					const values: CsvLine = new Map(line.split(',').map((value, idx) =>
						[this.columns[idx], value as unknown as number]
					));

					if((values.get(PersistentTurnGroup.TURN_COLUMN) as number) > this.lastTurn) {
						const playerLines: CsvLine[] = this.recentTurns.slice(-this.players);
						_.forEach(this.listeningFns, fn => {
							playerLines.forEach((line, idx) => fn(idx, line));
						});
					}
				}
			});
			return tail;
		} catch(error) {
			return undefined;
		}
	}

	on (input: (slot: number, s:CsvLine) => void) {
		this.listeningFns.push(input);
	}
}
