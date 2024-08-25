import _, {max} from 'lodash';
import { Game, deal } from './Game';
import path from 'path';
import {CsvLine, PersistentTail, PersistentTurnGroup} from './PersistentTail';
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
	var table = blessed.table({tags: true});
	screen.append(table);
	screen.render();

	const arrayToLogs = ['AppData', 'Local', 'Firaxis Games', "Sid Meier's Civilization VI", "Logs"];
	const likelyLogLocation = _.join([os.homedir()].concat(arrayToLogs), path.sep);
	// const likelyLogLocation = _.join([__dirname].concat('diplomacy_deals_test_2'), path.sep);

	console.log('reading log files.');

	const tradeDealsLog = new PersistentTail(likelyLogLocation + path.sep + 'DiplomacyDeals.log');
	const gameCoreLog = new PersistentTail(likelyLogLocation + path.sep + 'GameCore.log');
	const statsLog = new PersistentTurnGroup(likelyLogLocation + path.sep + 'Player_stats.csv');
	
	console.log(`tradeDealsLog, gameCoreLog ${tradeDealsLog.dirname}, ${gameCoreLog.dirname}` );
	const game = initializeGame({tradeDealsLog: tradeDealsLog, gameCoreLog: gameCoreLog, statsLog: statsLog});

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

function initializeGame(input: {tradeDealsLog: PersistentTail, gameCoreLog: PersistentTail, statsLog: PersistentTurnGroup}): Game {
	const game = new Game();
	var roomSize = 0;
	input.gameCoreLog.on((s: string) => {
		if(s.indexOf('SlotStatus - Human') != -1) {
			//'Line 410: [2690167.701] Player 0: Civilization - CIVILIZATION_INCA (-1955030529)  Leader - LEADER_PACHACUTI (1425321953), - Level - CIVILIZATION_LEVEL_FULL_CIV, SlotStatus - Human'
			const parsing = _.split(s, ' ');
			// find player parse next token as an integer because that's their slot. 
			const playerPosition = parseInt(parsing[_.indexOf(parsing, 'Player')+1]);
			roomSize = max([playerPosition, roomSize]) as number;
			const civ = _.split(_.find(parsing, (y) => y.indexOf('CIVILIZATION') != -1) as string, '_')[1];
			const leader = _.join(_.slice(_.split(_.find(parsing, (y) => y.indexOf('LEADER') != -1) as string, '_'), 1), '_');
			game.setPlayerName({slotNumber: playerPosition, name: civ});
		}
	});
	// setTimeout(() => console.log(civs), 2000);
	var turnNumber = 1;
	input.tradeDealsLog.on((s: string) => {
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

	input.statsLog.players = roomSize;
	input.statsLog.on((player: number, stats: CsvLine) => {
		game.upsertGpt(player, stats.get("Game Turn") as number - 1, stats.get("YIELDS: GOLD") as number)
	});

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

main();