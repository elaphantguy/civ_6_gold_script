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
	turnSnaps: {[number: number]: {[name: number]: PlayerSnap}};
	latestTurn: number;
	deals: deal[];
	gptDeals: deal[];
	listeningFns: (() => void)[];
	constructor() {
		this.turnSnaps = [];
		this.players = {};
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
		const curTurn = turnNumber ? turnNumber: this.latestTurn;
		var ret: string[][] = [
			['luxes sent'],
			['luxes recieved'],
			['L s-r'],
			['sent'], 
			['sent adj.'], 
			['recieved'], 
			['recieved adj.'], 
			['net'], 
			['net adj.'], 
			[`Turn ${curTurn}`]];
		_.forEach(this.turnSnaps[curTurn], (player, key) => {
			const sent = player.net.sent;
			const sentWithInterest = _.floor(player.net.sentWithInterest);
			const recieved = player.net.recieved;
			const recievedWithInterest = _.floor(player.net.recievedWithInterest);
			const net = player.net.net();
			const netWithIntrest = _.floor(player.net.netWithIntrest());
			var i = 0;
			ret[i++].push(`${player.net.sentLuxes}`);
			ret[i++].push(`${player.net.recievedLuxes}`);
			ret[i++].push(`${colorValue(player.net.sentLuxes - player.net.recievedLuxes)}`);
			ret[i++].push(`${sent}`);
			ret[i++].push(`${sentWithInterest}`);
			ret[i++].push(`${recieved}`);
			ret[i++].push(`${recievedWithInterest}`);
			ret[i++].push(`${colorValue(net)}`);
			ret[i++].push(`${colorValue(netWithIntrest)}`);
			ret[i++].push(this.players[key as any].name);
		});
		return ret;
	}

	lineDataNet(turnNumber?: number) : {title: string, x: string[], y: number[]}[] {
		const curTurn = turnNumber ? turnNumber: this.latestTurn;
		// initialize the line datums for each player. 
		var nets = _.mapValues(this.players, (player) => {
			return {
				title: player.name,
				x: [] as string[],
				y: [] as number[]
			}
		});

		for(var i = 1; i < curTurn; i++) {
			_.forEach(this.turnSnaps[curTurn], (player, key) => {
				nets[key as any].x.push('t' + i);
				nets[key as any].y.push(player.net.net());
			});
		}
		return _.values(nets);
	}

	setPlayerName(input: {slotNumber: number, name: string}) {
		this.getPlayer(input.slotNumber).setName(`[${input.slotNumber}] ${input.name}`);
		_.forEach(this.listeningFns, fn => {
			fn();
		});
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
			this.applyInterestTick();
			_.forEach(this.gptDeals, runningDeal => {
				if (runningDeal.turn + runningDeal.duration > this.latestTurn) {
					this.doSingleTurnDeal(runningDeal);
				}
			});
			// add a turn to the snapshots. 
			this.latestTurn+=1;
			this.turnSnaps[this.latestTurn] = (_.mapValues(this.players, (value) => {
				return new PlayerSnap(value.summedRelationship);
			}));
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

	applyInterestTick() {
		_.forEach(this.players, player => {
			player.applyInterestTick();
		});
	}

	// handles getting all the players by itself, does not fail but makes more players. 
	getPlayer(index: number): Player {
		if (!this.players[index]) {
			this.players[index] = new Player(`${index}`);
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

export class PlayerSnap {
	net: RelationShip;
	constructor(val: RelationShip) {
		this.net = new RelationShip();
		this.net.recieved = val.recieved;
		this.net.recievedWithInterest = val.recievedWithInterest;
		this.net.sent = val.sent;
		this.net.sentWithInterest = val.sentWithInterest;
		this.net.sentLuxes = val.sentLuxes;
		this.net.recievedLuxes = val.recievedLuxes;
	}
}

export class Player {
	relationships: {[name:number]: RelationShip};
	summedRelationship: RelationShip;
	name: string;
	constructor(name: string) {
		this.relationships = {};
		this.name = name;
		this.summedRelationship = new RelationShip();
	}
	
	clearDeals() {
		this.relationships = {};
		this.summedRelationship = new RelationShip();
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
	applyInterestTick() {
		this.summedRelationship.applyInterestTick();
		_.forEach(this.relationships, relationship => {
			relationship.applyInterestTick();
		});
	};
}