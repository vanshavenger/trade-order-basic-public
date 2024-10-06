import express, { type Request, type Response } from 'express';
import { Side, type Order, type User } from './types';

export const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export const TICKER = 'AAPL';

let users: User[] = [
    {
        id: '1',
        balances: {
            [TICKER]: 10,
            'USD': 50000,
        },
    },
    {
        id: '2',
        balances: {
            [TICKER]: 10,
            'USD': 50000,
        },
    },
];

let bids: Order[] = [];
let asks: Order[] = [];
let nextOrderId = 1;

app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
});

const fillOrders = (side: Side, userId: string, price: number, quantity: number): number => {
    let remainingQuantity = quantity;
    const oppositeOrders = side === Side.BUY ? asks : bids;
    let filledQuantity = 0;
    
    oppositeOrders.sort((a, b) => {
        if (side === Side.BUY) {
            return a.price === b.price ? a.timestamp - b.timestamp : a.price - b.price;
        } else {
            return a.price === b.price ? a.timestamp - b.timestamp : b.price - a.price;
        }
    });

    for (let i = 0; i < oppositeOrders.length && remainingQuantity > 0; i++) {
        const order = oppositeOrders[i];

        if ((side === Side.BUY && order.price > price) ||
            (side === Side.SELL && order.price < price)) {
            continue;
        }

        const fillQuantity = Math.min(remainingQuantity, order.quantity);
        remainingQuantity -= fillQuantity;
        filledQuantity += fillQuantity;
        
        updateBalances(order.userId, userId, order.price, fillQuantity, side);

        if (fillQuantity === order.quantity) {
            oppositeOrders.splice(i, 1);
            i--;
        } else {
            order.quantity -= fillQuantity;
        }
    }

    return filledQuantity;
};

const updateBalances = (fromUserId: string, toUserId: string, price: number, quantity: number, side: Side) => {
    const fromUser = users.find(u => u.id === fromUserId);
    const toUser = users.find(u => u.id === toUserId);

    if (!fromUser || !toUser) {
        throw new Error('User not found');
    }

    if (side === Side.BUY) {
        fromUser.balances[TICKER] -= quantity;
        fromUser.balances.USD += price * quantity;
        toUser.balances[TICKER] += quantity;
        toUser.balances.USD -= price * quantity;
    } else {
        fromUser.balances[TICKER] += quantity;
        fromUser.balances.USD -= price * quantity;
        toUser.balances[TICKER] -= quantity;
        toUser.balances.USD += price * quantity;
    }
};

app.post('/order', (req: Request, res: Response) => {
    const { side, userId, price, quantity } = req.body;

    if (!Object.values(Side).includes(side) || !userId || quantity <= 0 || price <= 0 || isNaN(price)) {
        res.status(400).json({ error: 'Invalid order parameters' });
        return;
    }

    const user = users.find(u => u.id === userId);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    const tempBalances = { ...user.balances };
    
    if (side === Side.BUY) {
        if (tempBalances.USD < price * quantity) {
            res.status(400).json({ error: 'Insufficient USD balance' });
            return;
        }
    } else {
        if (tempBalances[TICKER] < quantity) {
            res.status(400).json({ error: `Insufficient ${TICKER} balance` });
            return;
        }
    }

    if ((side === Side.BUY && user.balances.USD < price * quantity) ||
        (side === Side.SELL && user.balances[TICKER] < quantity)) {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
    }

    const filledQuantity = fillOrders(side, userId, price, quantity);
    const remainingQuantity = quantity - filledQuantity;


    if (remainingQuantity > 0) {
        const newOrder: Order = {
            id: (nextOrderId++).toString(),
            userId,
            price,
            quantity: remainingQuantity,
            timestamp: Date.now()
        };

        if (side === Side.BUY) {
            bids.push(newOrder);
            bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
        } else {
            asks.push(newOrder);
            asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
        }
    }

    res.json({
        orderId: nextOrderId - 1,
        filledQuantity,
        remainingQuantity
    });
});

app.get("/depth", (req: Request, res: Response) => {
    const depth: Record<string, { quantity: number, side: Side }> = {};

    for (const bid of bids) {
        if (!depth[bid.price]) {
            depth[bid.price] = { quantity: bid.quantity, side: Side.BUY };
        } else {
            depth[bid.price].quantity += bid.quantity;
        }
    }

    for (const ask of asks) {
        if (!depth[ask.price]) {
            depth[ask.price] = { quantity: ask.quantity, side: Side.SELL };
        } else {
            depth[ask.price].quantity += ask.quantity;
        }
    }

    res.json({ depth }).status(200);
});

app.get("/balance/:userId", (req: Request, res: Response) => {
    const userId = req.params.userId;
    const user = users.find(u => u.id === userId);
    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    res.json({ balances: user.balances }).status(200);
});

app.post("/quote", (req: Request, res: Response) => {
    const { side, quantity } = req.body;

    if (!Object.values(Side).includes(side) || quantity <= 0) {
        res.status(400).json({ error: 'Invalid quote parameters' });
        return;
    }

    const orders = side === Side.SELL ? bids : asks;
    let remainingQuantity = quantity;
    let totalCost = 0;

    const sortedOrders = [...orders].sort((a, b) => {
        if (side === Side.SELL) {
            return b.price - a.price; 
        } else {
            return a.price - b.price; 
        }
    });

    for (const order of sortedOrders) {
        if (remainingQuantity <= 0) break;

        const fillQuantity = Math.min(remainingQuantity, order.quantity);
        totalCost += fillQuantity * order.price;
        remainingQuantity -= fillQuantity;
    }

    if (remainingQuantity > 0) {
        res.status(400).json({ error: 'Not enough liquidity' });
        return;
    }

    res.json({ quote: totalCost });
});


app.post("/reset", (req: Request, res: Response) => {
    users = [
        {
            id: '1',
            balances: {
                [TICKER]: 10,
                'USD': 50000,
            },
        },
        {
            id: '2',
            balances: {
                [TICKER]: 10,
                'USD': 50000,
            },
        },
    ];
    bids = [];
    asks = [];
    nextOrderId = 1;
    res.json({ message: 'System reset successfully' });
});

app.post("/cancel", (req: Request, res: Response) => {
    const { orderId, userId } = req.body;

    const cancelOrder = (orders: Order[]) => {
        const index = orders.findIndex(order => order.id === orderId.toString() && order.userId === userId.toString());
        console.log('Orders:', orders);
        console.log(orderId, userId, index);
        if (index !== -1) {
            orders.splice(index, 1);
            return true;
        }
        return false;
    };

    if (cancelOrder(bids) || cancelOrder(asks)) {
        res.json({ message: 'Order cancelled successfully' });
    } else {
        res.status(404).json({ error: 'Order not found' });
    }
});

export { Side };