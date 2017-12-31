import assert = require("assert");
import Backtest = require("../src/service/backtest");
import Utils = require("../src/service/utils");
import Models = require("../src/common/models");
import Moment = require("moment");

describe("BacktestTests", () => {
    var timeProvider : Backtest.BacktestTimeProvider;

    beforeEach(() => {
        var t0 = Moment.unix(1);
        var t1 = Moment.unix(10);
        timeProvider = new Backtest.BacktestTimeProvider(t0, t1);
    });

    it("Should increment time", () => {
        timeProvider.scrollTimeTo(Moment.unix(2));
        assert.equal(timeProvider.utcNow().getTime() - Moment.unix(2).toDate().getTime(), 0);
    });

    it("Should not allow rewinding time", () => {
        timeProvider.scrollTimeTo(Moment.unix(6));
        assert.throws(() => timeProvider.scrollTimeTo(Moment.unix(2)));
    });

    it("Should handle timeouts", () => {
        var triggered = false;
        timeProvider.setTimeout(() => triggered = true, Moment.duration(4, "seconds"));

        timeProvider.scrollTimeTo(Moment.unix(2));
        assert.equal(triggered, false, "should not yet be triggered");

        timeProvider.scrollTimeTo(Moment.unix(7));
        assert.equal(triggered, true, "should be triggered");
    });

    it("Should handle timeouts in order", () => {
        var triggeredFirst = false;
        timeProvider.setTimeout(() => triggeredFirst = true, Moment.duration(4, "seconds"));

        var triggeredSecond = false;
        timeProvider.setTimeout(() => triggeredSecond = true, Moment.duration(7, "seconds"));

        timeProvider.scrollTimeTo(Moment.unix(2));
        assert.equal(triggeredFirst, false, "1 should not yet be triggered");
        assert.equal(triggeredSecond, false, "2 should not yet be triggered");

        timeProvider.scrollTimeTo(Moment.unix(7));
        assert.equal(triggeredFirst, true, "1 should be triggered");
        assert.equal(triggeredSecond, false, "2 should not yet be triggered");

        timeProvider.scrollTimeTo(Moment.unix(9));
        assert.equal(triggeredFirst, true, "1 should be triggered");
        assert.equal(triggeredSecond, true, "2 should be triggered");
    });

    it("Should handle intervals", () => {
        var nTimes = 0;
        timeProvider.setInterval(() => nTimes += 1, Moment.duration(2, "seconds"));

        timeProvider.scrollTimeTo(Moment.unix(9));
        assert.equal(nTimes, 3);
    });

    it("Should handle both intervals and timouts", () => {
        var nTimes = 0;
        timeProvider.setInterval(() => nTimes += 1, Moment.duration(2, "seconds"));

        var triggeredFirst = false;
        timeProvider.setTimeout(() => triggeredFirst = true, Moment.duration(4, "seconds"));

        var triggeredSecond = false;
        timeProvider.setTimeout(() => triggeredSecond = true, Moment.duration(7, "seconds"));

        timeProvider.scrollTimeTo(Moment.unix(2));
        assert.equal(nTimes, 0);
        assert.equal(triggeredFirst, false, "1 should not yet be triggered");
        assert.equal(triggeredSecond, false, "2 should not yet be triggered");

        timeProvider.scrollTimeTo(Moment.unix(7));
        assert.equal(nTimes, 2);
        assert.equal(triggeredFirst, true, "1 should be triggered");
        assert.equal(triggeredSecond, false, "2 should not yet be triggered");

        timeProvider.scrollTimeTo(Moment.unix(9));
        assert.equal(nTimes, 3);
        assert.equal(triggeredFirst, true, "1 should be triggered");
        assert.equal(triggeredSecond, true, "2 should be triggered");
    });
});

describe("BacktestGatewayTests", () => {
    it("should read market data", () => {
        var inputData : Array<Models.Market | Models.MarketTrade> = [
            new Models.Market([new Models.MarketSide(10, 5)], [new Models.MarketSide(20, 5)], Moment.unix(1).toDate()),
            new Models.Market([new Models.MarketSide(15, 5)], [new Models.MarketSide(20, 5)], Moment.unix(10).toDate()),
        ];

        var timeProvider = new Backtest.BacktestTimeProvider(Moment.unix(1), Moment.unix(40));
        var gateway = new Backtest.BacktestGateway(inputData, 10, 5000, timeProvider);

        gateway.MarketData.on(m => {
            gateway.sendOrder(null/*new Models.BrokeredOrder("A", Models.Side.Ask, 3, Models.OrderType.Limit, 12, Models.TimeInForce.GTC, Models.Exchange.Null)*/);
        });

        var gotTrade = false;
        gateway.OrderUpdate.on(o => {
            if (o.orderStatus === Models.OrderStatus.Complete) {
                gotTrade = true;
                assert.equal(12, o.lastPrice);
                assert.equal(3, o.lastQuantity);
            }
        });

        /*gateway.PositionUpdate.on(p => {
            console.log(Models.Currency[p.currency], p.amount, p.heldAmount);
        });*/

        gateway.run();

        assert.equal(gotTrade, true, "never got trade");
    });
});


describe("Test event handling", function () {
    it("shoud fire Evt with single handler", () => {
        const Evt = new Utils.Evt<number>();

        const data: number[] = [];
        Evt.on((result) => result && data.push(result));

        Evt.trigger(1);

        assert.deepEqual(data, [1]);
    });

    it("shoud fire Evt with multiple handlers", () => {
        const Evt = new Utils.Evt<number>();

        const data: number[] = [];
        const handler_1 = (result) => result && data.push(result * 1);
        const handler_2 = (result) => result && data.push(result * 2);
        const handler_3 = (result) => result && data.push(result * 3);
        Evt.on(handler_1);
        Evt.on(handler_2);
        Evt.on(handler_3);

        Evt.trigger(1);

        assert.deepEqual(data, [1, 2, 3]);
    });

    it("shoud fire Evt with multiple handlers and removing handlers", () => {
        const Evt = new Utils.Evt<number>();

        const data: number[] = [];
        const handler_1 = (result) => result && data.push(result * 1);
        const handler_2 = (result) => result && data.push(result * 2);
        const handler_3 = (result) => result && data.push(result * 3);
        Evt.on(handler_1);
        Evt.on(handler_2);
        Evt.on(handler_3);

        Evt.off(handler_2);
        Evt.off(handler_3);

        Evt.trigger(1);

        assert.deepEqual(data, [1]);
    });
});
