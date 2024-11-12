import _ from "lodash";
// interest is approx '1.014' for 25 gold turn one to be 75 gold turn 80. 
// intrest is approx 1.035 for doubling in value every 20 turns. 
// this is similar to a builder buy for 2 sheep and 1 horse. 
// the amount it takes to pay for itself +100g of value is 20 turns. 
// hence 1.035 (1.036 to ensure it paid itself back and didn't just barely miss.)
const INTEREST_AMOUNT = 1.036;

export type deal = {
	from: number, 
	to: number, 
	amount: number, 
	duration: number, 
	turn: number
}

const colorValue = (value: number) => {
	const attr = value >= 0 ? '{green-bg}': '{red-bg}';
	return `${attr}${value}{/}`;
}

export class Game {
	players: {[name: number]: Player};
	rawCivToPlayers: {[rawCiv: string]: Player};
	latestTurn: number;
	deals: deal[];
	gptDeals: deal[];
	listeningFns: (() => void)[];
	constructor() {
		this.players = {};
		this.rawCivToPlayers = {};
		this.latestTurn = 1;
		this.deals = [];
		this.gptDeals = [];
		this.listeningFns = [];
	}

	registerNotifier(fn: () => void) {
		this.listeningFns.push(fn);
	}

	// returns a table of strings with headers for sent, recieved, interest, leader name. 
	// contains markup for the table that we generate
	print(turnNumber?: number): string[][] {
		var curTurn = this.latestTurn - 1;
		if (turnNumber !== undefined) {
			curTurn = turnNumber;
		}
		var ret: string[][] = [
			['luxes sent'],
			['luxes recieved'],
			['L s-r'],
			['sent'], 
			['sent adj.'], 
			['recieved'], 
			['recieved adj.'], 
			// [% Given / Taken from team] EX one guy is giving away everything, while everyone else takes 100% -20% -60% -20%
			// % over-gpt the % of resources used / given above natural GPT E.G turn 20 took 500 gold -400% (took 4 players worth of gold)
			['gpt'],
			['gold to date'], 
			['net'], 
			['net adj.'],
			[`Turn ${curTurn}`]];
		_.forEach(this.players, (p, key) => {
			const turn = p.turns[curTurn];
			if (turn) {
				const toTeam = turn.net ?? new RelationShip();
				const sent = toTeam.sent;
				const sentWithInterest = _.floor(toTeam.sentWithInterest);
				const recieved = toTeam.recieved;
				const recievedWithInterest = _.floor(toTeam.recievedWithInterest);
				const net = toTeam.net();
				const netWithIntrest = _.floor(toTeam.netWithIntrest());
				var i = 0;
				ret[i++].push(`${toTeam.sentLuxes}`);
				ret[i++].push(`${toTeam.recievedLuxes}`);
				ret[i++].push(`${colorValue(toTeam.sentLuxes - toTeam.recievedLuxes)}`);
				ret[i++].push(`${sent}`);
				ret[i++].push(`${sentWithInterest}`);
				ret[i++].push(`${recieved}`);
				ret[i++].push(`${recievedWithInterest}`);
				ret[i++].push(`${colorValue(turn.stats.gpt)}`);
				ret[i++].push(`${colorValue(turn.cumulativeGoldGenerated)}`);
				ret[i++].push(`${colorValue(net)}`);
				ret[i++].push(`${colorValue(netWithIntrest)}`);
				ret[i++].push(this.players[key as any].name);
			}
		});
		return ret;
	}

	setPlayerName(input: {slotNumber: number, name: string, rawCiv: string}) {
		this.getPlayer(input.slotNumber).setRawCiv(input.rawCiv);
		this.rawCivToPlayers[input.rawCiv] = this.getPlayer(input.slotNumber);
		this.getPlayer(input.slotNumber).setName(`[${input.slotNumber}] ${input.name}`);
		_.forEach(this.listeningFns, fn => {
			fn();
		});
	}

	recordGpt(input: {rawCiv: string, gpt: number, turnNumber: number}) {
		const player = this.rawCivToPlayers[input.rawCiv];
		if (!player) {
			// Very often the player won't exist because there are city states / initialization race conditions xd.
			return;
		}
		player.recordStats({turnNumber: input.turnNumber, gpt: input.gpt});
	}

	newGame(latestTurn: number) {
		// the names are preserved because those are set async. 
		// so just clear out the deals. 
		_.forEach(this.players, player => {
			player.clearDeals();
		});
		this.gptDeals = [];
		this.deals = [];
		this.latestTurn = latestTurn;
	}

	doLuxDeal(deal: {from: number, to: number}) {
		this.getPlayer(deal.from).sendLux(deal.to);
		this.getPlayer(deal.to).recieveLux(deal.from);
	}

	doDeal(deal: deal) {
		// double check that a new game didn't start in the log file by just reseting everything. 
		if (deal.turn < this.latestTurn) {
			this.newGame(deal.turn);
		}
		while (this.latestTurn < deal.turn) {
			this.applyInterestTick(this.latestTurn);
			_.forEach(this.gptDeals, runningDeal => {
				if (runningDeal.turn + runningDeal.duration > this.latestTurn) {
					this.doSingleTurnDeal(runningDeal);
				}
			});
			this.latestTurn+=1;
		}
		this.deals.push(deal);
		if (deal.duration > 0) {
			this.gptDeals.push(deal);
		} else {
			this.doSingleTurnDeal(deal);
		}
		this.notifyFrontend();
	}

	notifyFrontend() {
		_.forEach(this.listeningFns, fn => {
			fn();
		});
	}

	doSingleTurnDeal(deal: deal) {
		this.getPlayer(deal.from).sendMoney(deal.to, deal.amount);
		this.getPlayer(deal.to).recieveMoney(deal.from, deal.amount);
	}

	applyInterestTick(turnNumber: number) {
		_.forEach(this.players, player => {
			player.applyInterestTick(turnNumber);
		});
	}

	// handles getting all the players by itself, does not fail but makes more players. 
	getPlayer(index: number): Player {
		if (!this.players[index]) {
			this.players[index] = new Player(`${index}`, `${index}_RAW_CIV`);
		}
		return this.players[index];
	}
}

export class RelationShip {
	sent: number;
	recieved: number;
	sentWithInterest: number;
	recievedWithInterest: number;
	sentLuxes: number;
	recievedLuxes: number;
	constructor() {
		this.sent = 0;
		this.recieved = 0;
		this.sentWithInterest = 0;
		this.recievedWithInterest = 0;
		this.sentLuxes = 0;
		this.recievedLuxes = 0;
	}

	net() {
		return this.sent - this.recieved;
	}

	netWithIntrest() {
		return this.sentWithInterest - this.recievedWithInterest;
	}

	sendLux() {
		this.sentLuxes += 1;
	}

	recieveLux() {
		this.recievedLuxes += 1;
	}

	sendGold(amount: number) {
		this.sent += amount;
		this.sentWithInterest += amount;
	}

	recieveGold(amount: number) {
		this.recieved += amount;
		this.recievedWithInterest += amount;
	}

	applyInterestTick() {
		this.sentWithInterest *= INTEREST_AMOUNT;
		this.recievedWithInterest *= INTEREST_AMOUNT;
	}
}

class Turn {
	net?: RelationShip;
	stats: {gpt: number};
	cumulativeGoldGenerated: number;
	constructor() {
		// default to 5 if it's bugged because it's the default GPT /shrug
		this.stats = {gpt: 5};
		this.cumulativeGoldGenerated = 0;
	};
}

export class Player {
	
	turns: {[turnNumber: number]: Turn};
	// current turn
	relationships: {[name:number]: RelationShip};
	// current turn
	summedRelationship: RelationShip;
	name: string;
	// used to merge various civ files together. 
	rawCiv: string;
	constructor(name: string, rawCiv : string) {
		this.relationships = {};
		this.name = name;
		this.rawCiv = name;
		this.summedRelationship = new RelationShip();
		this.turns = [];
	}
	
	clearDeals() {
		this.relationships = {};
		this.turns = {};
		this.summedRelationship = new RelationShip();
	}

	setRawCiv(rawCiv: string) {
		this.rawCiv = rawCiv;
	}

	setName(name: string) {
		this.name = name;
	}

	private getRelationship(id: number): RelationShip {
		if(!this.relationships[id]) {
			this.relationships[id] = new RelationShip();
		}
		return this.relationships[id];
	}

	sendLux(to: number) {
		this.summedRelationship.sendLux();
		this.getRelationship(to).sendLux();
	}

	recieveLux(from: number) {
		this.summedRelationship.recieveLux();
		this.getRelationship(from).recieveLux();
	}

	sendMoney(to: number, amount: number) {
		this.summedRelationship.sendGold(amount);
		this.getRelationship(to).sendGold(amount);
	}
	recieveMoney(from: number, amount: number) {
		this.summedRelationship.recieveGold(amount);
		this.getRelationship(from).recieveGold(amount);
	}

	recordStats(input: { turnNumber: number; gpt: number; }) {
		if (!this.turns[input.turnNumber]) {
			this.turns[input.turnNumber] = new Turn();
		} 
		this.turns[input.turnNumber].stats = {gpt: input.gpt};
		if (this.turns[input.turnNumber - 1]) {
			this.turns[input.turnNumber].cumulativeGoldGenerated = this.turns[input.turnNumber - 1].cumulativeGoldGenerated + input.gpt;
		} else {
			this.turns[input.turnNumber].cumulativeGoldGenerated = input.gpt;
		}
	}

	// called once per turn =) ;
	applyInterestTick(turnNumber: number) {
		var net = new RelationShip();
		net.recieved = this.summedRelationship.recieved;
		net.recievedLuxes = this.summedRelationship.recievedLuxes;
		net.recievedWithInterest = this.summedRelationship.recievedWithInterest;
		net.sent = this.summedRelationship.sent;
		net.sentLuxes = this.summedRelationship.sentLuxes;
		net.sentWithInterest = this.summedRelationship.sentWithInterest;
		if (!this.turns[turnNumber]) {
			this.turns[turnNumber] = new Turn();
		} 	
		this.turns[turnNumber].net = net;

		this.summedRelationship.applyInterestTick();
		_.forEach(this.relationships, relationship => {
			relationship.applyInterestTick();
		});
	};
}