import _ from 'lodash';
import { Game, deal } from './Game';
import path from 'path';
import { PersistentTail } from './PersistentTail';
import blessed from 'blessed';
import os from 'os';

// screen.on('keypress', function(_, key) {
// 	console.log(key.full);
// });

var showingTurn: number = 1;
var latestTurn: number = 1;

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
		latestTurn = game.latestTurn;
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
			const civ = _.split(_.find(parsing, (y) => y.indexOf('CIVILIZATION') != -1) as string, '_')[1];
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
		input.status.setContent('parsing GPT');
		playerStatsCsv.on((s: string) => {
			const stats = getStatsFromLine(s);
			input.status.setContent('parsing GPT latest turn - ' + stats.turnNumber);
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

function getStatsFromLine(line: string): {turnNumber: number, rawCiv: string, gpt: number} {
	// All one line =)
	// Game Turn, Player, Num Cities, Population, Techs, Civics, Land Units, corps, Armies, Naval Units, 
	// TILES: Owned, Improved, 
	// BALANCE: Gold, Faith, 
	// YIELDS: Science, Culture, Gold, Faith, Production, Food
	const split = _.split(line, ', ');
	if (split[0].startsWith('Game')) {
		return {turnNumber: 0, rawCiv: 'Haleykwrotethismessage', gpt: 9001};
	}
	const turnNumber = parseInt(split[0]) - 1;
	const rawCiv = split[1];
	const gpt = parseInt(split[16]);
	return {turnNumber: turnNumber, rawCiv: rawCiv, gpt: gpt};
}

main();