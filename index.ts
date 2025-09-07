import _ from 'lodash';
import { Game, deal } from './Game';
import path from 'path';
import { PersistentTail } from './PersistentTail';
import blessed from 'blessed';
import os from 'os';

// screen.on('keypress', function(_, key) {
// 	console.log(key.full);
// });
const CUSTOM_CIV_CREATOR_ALIASES = ['SUK', 'LIME'];

var showingTurn: number = 1;

// helper class for getStatsFromLine so that we can refrence by slot order
// effectively turns a for each loop into a for loop
// but it still works like a listener
class TurnLineCounter {
	turnNumber: number;
	slotNumber: number;
	game: Game;
	constructor(game: Game) {
		this.turnNumber = 0;
		this.slotNumber = 0;
		this.game = game;
		this.increment = this.increment.bind(this);
	}

	increment(turnNumber: number, rawCiv: string): number {
		if (this.game.isPlayer(rawCiv)) {
			if (turnNumber > this.turnNumber) {
				this.turnNumber = turnNumber;
				this.slotNumber = 0;
			} else {
				this.slotNumber+=1;
			}
		}
		return this.slotNumber;
	}
}

async function main() {
	const screen = blessed.screen({  smartCSR: true	});
	screen.key(['escape', 'q', 'C-c'], function(ch, key) {
		return process.exit(0);
	});

	var table = blessed.table({tags: true, shrink: true, top: 1});
	var status = blessed.box({shrink: true, top: 0});

	status.setContent('Not yet parsing');
	screen.append(table);
	screen.append(status);
	screen.render();

	const arrayToLogs = ['AppData', 'Local', 'Firaxis Games', "Sid Meier's Civilization VI", "Logs"];
	const likelyLogLocation = _.join([os.homedir()].concat(arrayToLogs), path.sep);
	// const likelyLogLocation = 'test_logs';

	console.log('Using log files from directory ' + likelyLogLocation);
	const game = initializeGame({
		logLocation: likelyLogLocation, 
		status: status});

	const reprintTableFn = () => {
		table.setData(game.print());	
		showingTurn = game.latestTurn;
		screen.render();
	};
	screen.key(['left', 'up', 'a', 'w'], function(_, key) {
		showingTurn -= 1;
		table.setData(game.print(showingTurn));
		screen.render();
	});
	screen.key(['right', 'down', 'd', 's'], function(_, key) {
		showingTurn += 1;
		table.setData(game.print(showingTurn));
		screen.render();
	});
	game.registerNotifier(reprintTableFn);
}

function initializeGame(input: {
	logLocation: string,
	status: blessed.Widgets.BoxElement
}): Game {
	const game = new Game();
	
	const tradeDealsLog = new PersistentTail(input.logLocation + path.sep + 'DiplomacyDeals.log');
	const gameCoreLog = new PersistentTail(input.logLocation + path.sep + 'GameCore.log');

	gameCoreLog.on((s: string) => {
		if(s.indexOf('SlotStatus - Human') != -1) {
			//'Line 410: [2690167.701] Player 0: Civilization - CIVILIZATION_INCA (-1955030529)  Leader - LEADER_PACHACUTI (1425321953), - Level - CIVILIZATION_LEVEL_FULL_CIV, SlotStatus - Human'
			const parsing = _.split(s, ' ');
			// find player parse next token as an integer because that's their slot. 
			const playerPosition = parseInt(parsing[_.indexOf(parsing, 'Player')+1]);
			const rawCiv = _.trim(_.find(parsing, (y) => y.indexOf('CIVILIZATION') != -1));
			var civ = 'UNKNOWN';
			if (CUSTOM_CIV_CREATOR_ALIASES.filter(alias => rawCiv.indexOf(alias) !== -1).length > 0) {
				civ = _.split(_.find(parsing, (y) => y.indexOf('CIVILIZATION') != -1) as string, '_')[2];
			} else {
				civ = _.split(_.find(parsing, (y) => y.indexOf('CIVILIZATION') != -1) as string, '_')[1];
			}
			const leader = _.join(_.slice(_.split(_.find(parsing, (y) => y.indexOf('LEADER') != -1) as string, '_'), 1), '_');
			game.setPlayerName({slotNumber: playerPosition, name: civ, rawCiv: rawCiv as string});
		} 
	});
	
	var turnNumber = 1;
	tradeDealsLog.on((s: string) => {
		if (s.indexOf('Turn') != -1) {
			//Turn 1, Enacting Deal id 1002 for player 6 and 4
			turnNumber = parseInt(_.split(_.split(s, ',')[0], ' ')[1]);
		} 
		if (s.indexOf('YIELD_GOLD') != -1) {
			var deal = getDealFromLine(s);
			deal.turn = turnNumber;
			game.doDeal(deal);			
		}
		const resourceIndex = s.indexOf('RESOURCE');
		if (resourceIndex != -1) {
			const cut_at_resource = s.slice(resourceIndex);
			if (['RESOURCE_HORSES', 'RESOURCE_IRON', 'RESOURCE_NITER', 'RESOURCE_OIL', 'RESOURCE_ALUMINUM', "RESOURCE_COAL", "RESOURCE_URANIUM"].filter(f => cut_at_resource.startsWith(f)).length == 0 ) {
				// a lux deal was made here. 
				game.doLuxDeal(getLuxDealFromLine(s));
			}
		}
	});

	// typically the program has completed grabbing everything in the log files in 3 seconds. 
	// so at that point go back in and backfill the GPT. 
	// GPT parsing depends upon civilization names being lined up with slot order
	// which depends upon gamecore parsing being completed. 
	setTimeout(() => {
		const playerStatsCsv = new PersistentTail(input.logLocation + path.sep + 'Player_Stats.csv');
		const turnLineCounter = new TurnLineCounter(game); 
		input.status.setContent('parsing stats file');
		playerStatsCsv.on((s: string) => {
			const stats = getStatsFromLine(s, turnLineCounter);
			input.status.setContent('parsing stats file: latest turn - ' + stats.turnNumber);
			(input.status.parent as unknown as blessed.Widgets.Screen).render();
			game.recordGpt(stats);
		});
	}, 1500);

	return game;
}

function getLuxDealFromLine(line: string) {
	const parsing = _.split(line, ',');
	var from = -1, to = -1;
	// ', Enacting Deal Item ID 2, from player 9, to player 7, type Gold, subType 0 (), value type YIELD_GOLD, amount 5, duration 0'
	parsing.forEach(section => {
		if (section.indexOf('from player') != -1) {
			const words = _.split(section, ' ');
			// the final word is the player index
			from = parseInt(words[words.length - 1]);
		} else if (section.indexOf('to player') != -1) {
			const words = _.split(section, ' ');
			// the final word is the player index
			to = parseInt(words[words.length - 1]);
		}
	});
	return {from: from, to: to};
}

function getDealFromLine(line: string): deal {
	const parsing = _.split(line, ',');
	var from = -1, to = -1, amount = -1, duration = -1;
	// ', Enacting Deal Item ID 2, from player 9, to player 7, type Gold, subType 0 (), value type YIELD_GOLD, amount 5, duration 0'
	parsing.forEach(section => {
		if (section.indexOf('from player') != -1) {
			const words = _.split(section, ' ');
			// the final word is the player index
			from = parseInt(words[words.length - 1]);
		} else if (section.indexOf('to player') != -1) {
			const words = _.split(section, ' ');
			// the final word is the player index
			to = parseInt(words[words.length - 1]);
		} else if (section.indexOf('amount') != -1) {
			const words = _.split(section, ' ');
			// the final word is the gold amount
			amount = parseInt(words[words.length - 1]);
		} else if(section.indexOf('duration') != -1) {
			const words = _.split(section, ' ');
			// the final word is the duration
			duration = parseInt(words[words.length - 1]);	
		}
	});
	return {from: from, to: to, amount: amount, duration: duration, turn: -1};
}

// TODO FREE_CITIES is always last and we can use slot order for the remainder of civs
// but if two civs are the same then they show up as uhh, the same name
// so using name was completely pointless, and we can pivot that to use slot order and a counter
// off of free_cities, the first civ was civ_england this game, slot 0, and then correct for rest of them
// so... TODO fix that. 
// 62, CIVILIZATION_FREE_CITIES, 0, 0, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
// 62, CIVILIZATION_ENGLAND, 6, 45, 24, 22, 23, 0, 0, 0, 86, 29, 73, 976, 97, 50, 118, 17, 162, 142
// 62, CIVILIZATION_MAORI, 8, 59, 27, 22, 13, 0, 0, 1, 156, 32, 82, 435, 138, 57, 110, 24, 161, 216
// 62, CIVILIZATION_ROME, 8, 71, 29, 24, 23, 0, 0, 1, 140, 50, 118, 386, 171, 134, 152, 50, 232, 238
// 62, CIVILIZATION_FRANCE, 4, 30, 21, 22, 27, 0, 0, 0, 68, 22, 118, 195, 76, 74, 60, 5, 85, 101
// 62, CIVILIZATION_CANADA, 8, 49, 20, 25, 5, 0, 0, 1, 136, 42, 213, 185, 78, 245, 131, 81, 160, 147
// 62, CIVILIZATION_FRANCE, 6, 54, 25, 26, 23, 0, 0, 0, 115, 36, 50, 204, 112, 153, 127, 11, 158, 158
// 62, CIVILIZATION_BRAZIL, 6, 56, 28, 21, 16, 0, 0, 1, 99, 22, 304, 201, 169, 77, 151, 9, 184, 193
// 62, CIVILIZATION_ZULU, 7, 47, 23, 21, 8, 2, 0, 0, 107, 37, 70, 358, 98, 47, 42, 12, 150, 145
// 62, CIVILIZATION_AMERICA, 8, 64, 22, 24, 7, 0, 0, 1, 141, 12, 53, 487, 134, 128, 77, 92, 168, 206
// 62, CIVILIZATION_POLAND, 5, 41, 24, 23, 27, 0, 0, 1, 97, 47, 28, 518, 79, 98, 82, 173, 163, 137
// 62, CIVILIZATION_ENGLAND, 10, 68, 30, 22, 8, 0, 0, 9, 129, 48, 228, 225, 172, 75, 226, 8, 253, 221
// 62, CIVILIZATION_GERMANY, 6, 48, 25, 23, 14, 0, 0, 1, 102, 22, 118, 313, 90, 92, 106, 13, 203, 142

function getStatsFromLine(line: string, turnLineCounter: TurnLineCounter): {turnNumber: number, rawCiv: string, slotNumber: number, gpt: number} {
	// All one line =)
	// Game Turn, Player, Num Cities, Population, Techs, Civics, Land Units, corps, Armies, Naval Units, 
	// TILES: Owned, Improved, 
	// BALANCE: Gold, Faith, 
	// YIELDS: Science, Culture, Gold, Faith, Production, Food
	const split = _.split(line, ', ');
	if (split[0].startsWith('Game')) {
		// haleyKwrotethismessage
		return {turnNumber: 0, rawCiv: 'haleyKWroteThisMessage', slotNumber: 10000, gpt: 9001};
	}
	const turnNumber = parseInt(split[0]) - 1;
	const rawCiv = split[1];
	const gpt = parseInt(split[16]);
	return {
		turnNumber: turnNumber, 
		rawCiv: rawCiv, 
		slotNumber: turnLineCounter.increment(turnNumber, rawCiv), 
		gpt: gpt
	};
}

main();