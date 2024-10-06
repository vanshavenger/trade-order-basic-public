export enum Side {
    BUY = 'BUY',
    SELL = 'SELL',
}

export interface Balances extends Record<string, number> {}

export interface User {
    id: string;
    balances: Balances;
}

export interface Order {
    id: string;
    userId: string;
    price: number;
    quantity: number;
    timestamp: number;
}