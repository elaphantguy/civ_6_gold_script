import { Game } from "./Game";

function basicTestCase() {
	const game = new Game(); 

	game.doDeal({
		from: 0,
		to: 1,
		amount: 50,
		duration: 0,
		turn: 1
	});

	var trues: boolean[] = [];
	trues.push(game.players[0].summedRelationship.sent == 50);
	trues.push(game.players[0].summedRelationship.recieved == 0);
	trues.push(game.players[1].summedRelationship.recieved == 50);
	trues.push(game.players[1].summedRelationship.sent == 0);
	console.log(`1 deal case`);
	console.log(trues);
	trues = [];
	
	game.doDeal({
		from: 0,
		to: 1,
		amount: 50,
		duration: 0,
		turn: 5
	});

	trues.push(game.players[0].summedRelationship.sent == 100);
	trues.push(game.players[0].summedRelationship.recieved == 0);
	trues.push(game.players[1].summedRelationship.recieved == 100);
	trues.push(game.players[1].summedRelationship.sent == 0);

	
	trues.push(game.players[0].summedRelationship.sentWithInterest >= 100);
	trues.push(game.players[0].summedRelationship.sentWithInterest <= 103);
	trues.push(game.players[1].summedRelationship.recieved >= 100);
	trues.push(game.players[1].summedRelationship.sent <= 103);
	console.log(game.players[0].summedRelationship);
	console.log(`2 deals testing interest`);
	console.log(trues);
}
basicTestCase();

function interestTestCase() {
	const game = new Game(); 

	game.doDeal({
		from: 0,
		to: 1,
		amount: 10,
		duration: 30,
		turn: 1
	});
	game.doDeal({
		from: 0,
		to: 1,
		amount: 1,
		duration: 0,
		turn: 6
	});
	console.log(game.gptDeals);
  var trues = [];
	trues.push(game.players[0].summedRelationship.sent == 51);
	trues.push(game.players[0].summedRelationship.recieved == 0);
	trues.push(game.players[1].summedRelationship.recieved == 51);
	trues.push(game.players[1].summedRelationship.sent == 0);

	
	trues.push(game.players[0].summedRelationship.sentWithInterest >= 50);
	trues.push(game.players[0].summedRelationship.sentWithInterest <= 54);
	trues.push(game.players[1].summedRelationship.recieved >= 50);
	trues.push(game.players[1].summedRelationship.sent <= 54);
	console.log(game.players[0].summedRelationship);
	console.log(`2 deals testing interest & gpt`);
	console.log(trues);

}
interestTestCase();
