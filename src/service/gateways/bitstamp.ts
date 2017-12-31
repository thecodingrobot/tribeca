import Config = require("../config");
import crypto = require("crypto");
import request = require("request");
import Models = require("../../common/models");
import Utils = require("../utils");
import Interfaces = require("../interfaces");
import moment = require("moment");
import _ = require("lodash");
import Q = require("q");
import Pusher = require("pusher-js");

import log from "../logging";
import Logger = require("bunyan");
import shortId = require("shortid");
import {Side} from "../../common/models";

interface OrderBook {
    timestamp?: string;        // only present in the http get
    bids: [string, string][];
    asks: [string, string][];
}

interface Ticker {
    id: string;
    amount: number;
    price: number;
}

interface NewOrderAck {
    id: string;
    datetime: string;
    type: number; //  buy or sell (0 - buy; 1 - sell)
    price: number;
    amount: number;
}

interface Transaction {
    datetime: string;
    id: string;
    type: number; // (0 - deposit; 1 - withdrawal; 2 - market trade)
    usd: number;
    btc: number;
    fee: number;
    order_id: number;
}

interface MarketTransaction {
    date: string;
    tid: string;
    price: string;
    type: number;
    amount: string;
}

interface AccountBalance {
    bch_available: number;
    bch_balance: number;
    bch_reserved: number;
    bchbtc_fee: number;
    bcheur_fee: number;
    bchusd_fee: number;
    btc_available: number;
    btc_balance: number;
    btc_reserved: number;
    btceur_fee: number;
    btcusd_fee: number;
    eth_available: number;
    eth_balance: number;
    eth_reserved: number;
    ethbtc_fee: number;
    etheur_fee: number;
    ethusd_fee: number;
    eur_available: number;
    eur_balance: number;
    eur_reserved: number;
    eurusd_fee: number;
    ltc_available: number;
    ltc_balance: number;
    ltc_reserved: number;
    ltcbtc_fee: number;
    ltceur_fee: number;
    ltcusd_fee: number;
    usd_available: number;
    usd_balance: number;
    usd_reserved: number;
    xrp_available: number;
    xrp_balance: number;
    xrp_reserved: number;
    xrpbtc_fee: number;
    xrpeur_fee: number;
    xrpusd_fee: number;
}

class BitstampSymbolProvider {
    public symbol: string;

    constructor(public pair: Models.CurrencyPair) {
        this.symbol = `${Models.fromCurrency(pair.base)}${Models.fromCurrency(pair.quote)}`.toLowerCase();
    }
}

class PusherClient<T> {
    private _pusher: Pusher.Pusher;
    private _log: Logger;

    connectChanged = new Utils.Evt<Models.ConnectivityStatus>();
    private onConnectionStatusChange = () => {
        if (this._pusher.connection.state === "connected") {
            this.connectChanged.trigger(Models.ConnectivityStatus.Connected);
        }
        else {
            this.connectChanged.trigger(Models.ConnectivityStatus.Disconnected);
        }
    };

    message = new Utils.Evt<Models.Timestamped<T>>();

    private onMessage = (data) => {
        try {
            const t = new Date();
            this.message.trigger(new Models.Timestamped(data, t));
        } catch (error) {
            this._log.error("Error parsing data", data, error);
        }
    };

    constructor(url: string, name: string, endpointsAndEvents: [string, string][]) {
        this._log = log("tribeca:gateway:" + name);

        this._pusher = new Pusher("de504dc5763aeef9ff52", {cluster: "mt1", encrypted: true});
        this._pusher.connection
            .bind("connected", ctx => {
                this.onConnectionStatusChange();
                this._log.info("Pusher connection open. Ctx: %o", ctx);

                for (const endpoint of endpointsAndEvents) {
                    this._pusher.subscribe(endpoint[0]).bind(endpoint[1], msg => this.onMessage(msg));
                }
            })
            .bind("disconnected", ctx => {
                this.onConnectionStatusChange();
                this._log.info("Pusher connection closed. Ctx: %o", ctx);
            })
            .bind("error", ctx => {
                this.onConnectionStatusChange();
                this._log.info("Error opening Pusher connection. Code: %s Reason: %s", ctx.error.data.code, ctx.error.data.message);
            });
    }
}

class BitstampMarketDataGateway implements Interfaces.IMarketDataGateway {
    private _client: PusherClient<OrderBook | Ticker>;
    private _log: Logger = log("tribeca:gateway:BitstampMD");

    MarketData = new Utils.Evt<Models.Market>();
    MarketTrade = new Utils.Evt<Models.GatewayMarketTrade>();


    ConnectChanged = new Utils.Evt<Models.ConnectivityStatus>();

    private static ConvertToMarketSide = (input: [string, string]) => new Models.MarketSide(parseFloat(input[0]), parseFloat(input[1]));

    private static ConvertToMarketSideList = (input: [string, string][]) => _(input).slice(0, 5).map(BitstampMarketDataGateway.ConvertToMarketSide).value();

    private onOrderBookMessage = (message: Models.Timestamped<OrderBook>) => {
        const bids = BitstampMarketDataGateway.ConvertToMarketSideList(message.data.bids);
        const asks = BitstampMarketDataGateway.ConvertToMarketSideList(message.data.asks);
        this.MarketData.trigger(new Models.Market(bids, asks, message.time));
    };

    private onTicker = (message: Models.Timestamped<Ticker>) => {
        const trd = new Models.GatewayMarketTrade(message.data.price, message.data.amount, message.time, false, Side.Unknown);
        this.MarketTrade.trigger(trd);
    };

    private onMessage = (msg?: Models.Timestamped<OrderBook | Ticker>) => {
        if (!msg) return;
        if (msg.data.hasOwnProperty("id")) {
            this.onTicker(<Models.Timestamped<Ticker>>msg);
        }
        else {
            this.onOrderBookMessage(<Models.Timestamped<OrderBook>>msg);
        }
    };

    constructor(restClient: BitstampAuthenticatedClient, url: string, pair: BitstampSymbolProvider) {
        let endpoints: [string, string][] = [[`order_book_${pair.symbol}`, "data"], [`live_trades_${pair.symbol}`, "trade"]];
        if (pair.symbol === "btcusd") {
            endpoints = [[`order_book`, "data"], [`live_trades`, "trade"]];
        }
        this._client = new PusherClient(url, "BitstampPusherClient", endpoints);
        this._client.connectChanged.on(c => this.ConnectChanged.trigger(c));
        this._client.message.on(this.onMessage);

        restClient.getFromEndpoint<OrderBook>(`order_book/${pair.symbol}/`)
            .then(b => this.onOrderBookMessage(new Models.Timestamped(b, new Date())))
            .done();

        restClient.getFromEndpoint<MarketTransaction[]>(`transactions/${pair.symbol}/`)
            .then(ts => {
                ts.forEach(t => {
                    const side = t.type === 0 ? Models.Side.Bid : Models.Side.Ask; // is this really the make side?
                    const trd = new Models.GatewayMarketTrade(parseFloat(t.price), parseFloat(t.amount), moment(t.date, "X").toDate(), true, side);
                    this.MarketTrade.trigger(trd);
                });
            })
            .done();
    }
}

class BitstampAuthenticatedClient {
    private static UserAgent = "Mozilla/4.0 (compatible; Bitstamp node.js client)";

    constructor(private baseUrl: string,
                private _customerId: string,
                private _apiKey: string,
                private _secret: string) {
    }

    private _lastTimeMs = 0;
    private getNonce = () => {
        const t = new Date().getTime();
        if (t === this._lastTimeMs) {
            this._lastTimeMs++;
        }
        else {
            this._lastTimeMs = t * 100;
        }

        return this._lastTimeMs;
    };

    private addAuthentication = (req: {}) => {
        const nonce = this.getNonce();
        const message = nonce + this._customerId + this._apiKey;
        const signer = crypto.createHmac("sha256", new Buffer(this._secret, "utf8"));
        const signature = signer.update(message).digest("hex").toUpperCase();

        return _.extend({
            key: this._apiKey,
            signature,
            nonce
        }, req);
    };

    // the URLs must end with slashes in their API
    private makeUrl = (endpoint: string) => this.baseUrl + "/" + endpoint;

    public postToEndpoint = <TRequest, TResponse>(endpoint: string, req: TRequest): Q.Promise<TResponse> => {
        return this.requestFromEndpoint<TResponse>({
            url: this.makeUrl(endpoint),
            form: this.addAuthentication(req),
            method: "POST",
            timeout: 5000,
            headers: {"User-Agent": BitstampAuthenticatedClient.UserAgent}
        });
    };

    public getFromEndpoint = <TResponse>(endpoint: string) => {
        return this.requestFromEndpoint<TResponse>({
            url: this.makeUrl(endpoint),
            method: "GET",
            timeout: 5000,
            headers: {"User-Agent": BitstampAuthenticatedClient.UserAgent}
        });
    };

    private requestFromEndpoint = <TResponse>(options: request.Options) => {
        const defer = Q.defer<TResponse>();
        request(options, (err, resp, body) => {
            if (err) {
                defer.reject(err);
            }
            else {
                defer.resolve(JSON.parse(body));
            }
        });
        return defer.promise;
    };
}

class BitstampEntryGateway implements Interfaces.IOrderEntryGateway {
    OrderUpdate = new Utils.Evt<Models.OrderStatusUpdate>();
    ConnectChanged = new Utils.Evt<Models.ConnectivityStatus>();

    public cancelsByClientOrderId = false;

    supportsCancelAllOpenOrders = (): boolean => {
        return false;
    };
    cancelAllOpenOrders = (): Q.Promise<number> => {
        return Q(0);
    };

    cancelOrder = (cancel: Models.OrderStatusReport) => {
        this._client.postToEndpoint<{}, boolean>("cancel_order/", {id: cancel.exchangeId})
            .then(ack => {
                if (ack) {
                    this.OrderUpdate.trigger({
                        exchangeId: cancel.exchangeId,
                        orderId: cancel.orderId,
                        orderStatus: Models.OrderStatus.Cancelled
                    });
                }
                else {
                    this.OrderUpdate.trigger({
                        exchangeId: cancel.exchangeId,
                        orderStatus: Models.OrderStatus.Rejected,
                        cancelRejected: true
                    });
                }
            })
            .done();
        this.OrderUpdate.trigger({
            orderId: cancel.orderId,
            computationalLatency: Utils.fastDiff(new Date(), cancel.time)
        });
    };

    replaceOrder = (replace: Models.OrderStatusReport) => {
        this.cancelOrder(replace);
        this.sendOrder(replace);
    };

    sendOrder = (order: Models.OrderStatusReport) => {
        const side = order.side === Models.Side.Bid ? "buy/" : "sell/";

        const r: NewOrderAck = {
            id: shortId.generate(),
            datetime: new Date().toISOString(),
            type: order.side,
            price: order.price,
            amount: order.quantity
        };

        this._client.postToEndpoint<{}, NewOrderAck>(side, {amount: order.quantity, price: order.price})
            .then(ack => {
                this.OrderUpdate.trigger({
                    orderId: order.orderId,
                    exchangeId: ack.id,
                    orderStatus: Models.OrderStatus.Working
                });
            }).done();
        this.OrderUpdate.trigger({
            orderId: order.orderId,
            computationalLatency: Utils.fastDiff(new Date(), order.time)
        });
    };

    generateClientOrderId = (): string => shortId.generate();

    private downloadOrderStatuses = () => {
        // I really have no idea what to do here.
        //this._client.postToEndpoint("order_status/", )
    };

    _log: Logger = log("tribeca:gateway:BitstampOE");

    constructor(timeProvider: Utils.ITimeProvider, private _client: BitstampAuthenticatedClient) {
        timeProvider.setInterval(this.downloadOrderStatuses, moment.duration(10, "seconds"));
        timeProvider.setTimeout(() => this.ConnectChanged.trigger(Models.ConnectivityStatus.Connected), moment.duration(10));
    }
}

class BitstampPositionGateway implements Interfaces.IPositionGateway {
    _log: Logger = log("tribeca:gateway:BitstampPG");
    PositionUpdate = new Utils.Evt<Models.CurrencyPosition>();

    private onRefresh = () => {
        this._log.debug("Getting account balance...");
        this._client.postToEndpoint<{}, AccountBalance>(`balance/${this._pair.symbol}/`, {}).then(ack => {
            this._log.info("Account balance: %o", ack);

            // TODO add support for other pairs
            // ack[`${this._pair.pair.quote.toString().toLowerCase()}_balance`]
            this.PositionUpdate.trigger(new Models.CurrencyPosition(3 * 10 ** 4, ack.usd_reserved, Models.Currency.USD));
            this.PositionUpdate.trigger(new Models.CurrencyPosition(3, ack.btc_reserved, Models.Currency.BTC));
        }).done();
    };

    constructor(timeProvider: Utils.ITimeProvider, private _client: BitstampAuthenticatedClient, private _pair: BitstampSymbolProvider) {
        timeProvider.setInterval(this.onRefresh, moment.duration(20, "seconds"));
    }
}

class BitstampBaseGateway implements Interfaces.IExchangeDetailsGateway {
    public get hasSelfTradePrevention() {
        return false;
    }

    exchange(): Models.Exchange {
        return Models.Exchange.Bitstamp;
    }

    private _makeFee: number;
    private _takeFee: number;

    // this is provided dynamically via the `balance` request
    makeFee(): number {
        return this._makeFee;
    }

    // this is provided dynamically via the `balance` request
    takeFee(): number {
        return this._takeFee;
    }

    name(): string {
        return "Bitstamp";
    }

    minTickIncrement = 0.001;

    constructor(client: BitstampAuthenticatedClient, pair: BitstampSymbolProvider) {
        client.postToEndpoint<{}, { fee: number }>(`balance/${pair.symbol}/`, {})
            .then(balance => {
                this._takeFee = this._makeFee = balance.fee;
            })
            .done();
    }
}

class Bitstamp extends Interfaces.CombinedGateway {
    constructor(timeProvider: Utils.ITimeProvider, config: Config.IConfigProvider, pair: BitstampSymbolProvider) {
        const marketDataUrl = config.GetString("BitstampPusherUrl");
        const httpUrl = config.GetString("BitstampHttpUrl");
        const customerId = config.GetString("BitstampCustomerId");
        const apiKey = config.GetString("BitstampApiKey");
        const secret = config.GetString("BitstampSecret");

        const client = new BitstampAuthenticatedClient(httpUrl, customerId, apiKey, secret);
        const orderGateway = new BitstampEntryGateway(timeProvider, client);
        const positionGateway = new BitstampPositionGateway(timeProvider, client, pair);
        const marketDataGateway = new BitstampMarketDataGateway(client, marketDataUrl, pair);
        super(
            marketDataGateway,
            orderGateway,
            positionGateway,
            new BitstampBaseGateway(client, pair));
    }
}

export async function createBitstamp(timeProvider: Utils.ITimeProvider, config: Config.IConfigProvider, pair: Models.CurrencyPair): Promise<Interfaces.CombinedGateway> {
    return new Bitstamp(timeProvider, config, new BitstampSymbolProvider(pair));
}