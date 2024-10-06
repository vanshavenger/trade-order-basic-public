import request from "supertest";
import { app } from "../index";
import { expect, describe, beforeAll, it, beforeEach } from "bun:test";
import { TICKER } from "../constants";

describe("Advanced Trading System Tests", () => {
  beforeAll(async () => {
    await request(app).post("/reset").send();
  });

  describe("Initial Setup and Basic Functionality", () => {
    it("verifies initial balances", async () => {
      const res1 = await request(app).get("/balance/1").send();
      const res2 = await request(app).get("/balance/2").send();
      expect(res1.body.balances[TICKER]).toBe(10);
      expect(res2.body.balances[TICKER]).toBe(10);
      expect(res1.body.balances["USD"]).toBe(50000);
      expect(res2.body.balances["USD"]).toBe(50000);
    });

    it("can create multiple orders and verify depth", async () => {
      await request(app).post("/order").send({
        side: "BUY", price: 1400.1, quantity: 1, userId: "1"
      });
      await request(app).post("/order").send({
        side: "SELL", price: 1400.9, quantity: 10, userId: "2"
      });

      const res = await request(app).get("/depth").send();
      expect(res.status).toBe(200);
      expect(res.body.depth["1400.9"].quantity).toBe(10);
      expect(res.body.depth["1400.1"].quantity).toBe(1);
    });
  });

  describe("Order Execution and Balance Updates", () => {
    beforeEach(async () => {
      await request(app).post("/reset").send();
    });

    it("executes a matching order and updates balances", async () => {
      await request(app).post("/order").send({
        side: "SELL", price: 1400.9, quantity: 2, userId: "2"
      });
      
      const res = await request(app).post("/order").send({
        side: "BUY", price: 1401, quantity: 2, userId: "1"
      });
      expect(res.body.filledQuantity).toBe(2);

      const balance1 = await request(app).get("/balance/1").send();
      const balance2 = await request(app).get("/balance/2").send();
      expect(balance1.body.balances[TICKER]).toBe(12);
      expect(balance1.body.balances["USD"]).toBeCloseTo(50000 - 2 * 1400.9, 2);
      expect(balance2.body.balances[TICKER]).toBe(8);
      expect(balance2.body.balances["USD"]).toBeCloseTo(50000 + 2 * 1400.9, 2);
    });
  });

  describe("Advanced Order Scenarios", () => {
    beforeEach(async () => {
      await request(app).post("/reset").send();
    });

    it("handles partial fills correctly", async () => {
      await request(app).post("/order").send({
        side: "SELL", price: 1400, quantity: 5, userId: "2"
      });
      const res = await request(app).post("/order").send({
        side: "BUY", price: 1400, quantity: 3, userId: "1"
      });

      expect(res.body.filledQuantity).toBe(3);

      const depthRes = await request(app).get("/depth").send();
      expect(depthRes.body.depth["1400"].quantity).toBe(2);
      expect(depthRes.body.depth["1400"].side).toBe("SELL");
    });

    it("respects price-time priority", async () => {
      console.log("Starting price-time priority test");
      
      const buy1 = await request(app).post("/order").send({
        side: "BUY", price: 1390, quantity: 2, userId: "1"
      });
      console.log("First buy order response:", buy1.body);
      
      const buy2 = await request(app).post("/order").send({
        side: "BUY", price: 1395, quantity: 3, userId: "1"
      });
      console.log("Second buy order response:", buy2.body);

      const preSellDepth = await request(app).get("/depth").send();
      console.log("Order book before sell:", preSellDepth.body);

      const res = await request(app).post("/order").send({
        side: "SELL", price: 1390, quantity: 4, userId: "2"
      });
      console.log("Sell order response:", res.body);

      expect(res.body.filledQuantity).toBe(4);

      const balance1 = await request(app).get("/balance/1").send();
      const balance2 = await request(app).get("/balance/2").send();
      
      console.log("Final balances:", {
        user1: balance1.body.balances,
        user2: balance2.body.balances
      });

      expect(balance1.body.balances[TICKER]).toBe(14);
      expect(balance2.body.balances[TICKER]).toBe(6);
    });
    it("handles a complex series of orders correctly", async () => {
      const orders = [
        { side: "SELL", price: 1400, quantity: 3, userId: "2" },
        { side: "BUY", price: 1399, quantity: 2, userId: "1" },
        { side: "BUY", price: 1400, quantity: 2, userId: "1" },
        { side: "SELL", price: 1401, quantity: 1, userId: "2" },
        { side: "BUY", price: 1401, quantity: 2, userId: "1" },
      ];

      for (const order of orders) {
        await request(app).post("/order").send(order);
      }

      const depthRes = await request(app).get("/depth").send();
      const balance1 = await request(app).get("/balance/1").send();
      const balance2 = await request(app).get("/balance/2").send();

      expect(Object.keys(depthRes.body.depth).length).toBe(1);
      expect(depthRes.body.depth["1399"].quantity).toBe(2);
      expect(balance1.body.balances[TICKER]).toBe(14);
      expect(balance2.body.balances[TICKER]).toBe(6);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("rejects invalid orders", async () => {
      const res = await request(app).post("/order").send({
        side: "INVALID", price: 1400, quantity: 1, userId: "1"
      });
      expect(res.status).toBe(400);
    });

    it("handles zero quantity orders", async () => {
      const res = await request(app).post("/order").send({
        side: "BUY", price: 1400, quantity: 0, userId: "1"
      });
      expect(res.status).toBe(400);
    });

    it("prevents negative price orders", async () => {
      const res = await request(app).post("/order").send({
        side: "SELL", price: -100, quantity: 1, userId: "2"
      });
      expect(res.status).toBe(400);
    });
    it("prevents orders that would result in negative balances", async () => {
      const res = await request(app).post("/order").send({
        side: "BUY", price: 10000, quantity: 1000, userId: "1"
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Insufficient USD balance");
    });

  });

  describe("Concurrent Operations", () => {
    beforeEach(async () => {
      await request(app).post("/reset").send();
    });

    it("handles multiple simultaneous orders correctly", async () => {
      const orders = [
        { side: "BUY", price: 1400, quantity: 2, userId: "1" },
        { side: "SELL", price: 1400, quantity: 2, userId: "2" },
        { side: "BUY", price: 1401, quantity: 1, userId: "1" },
        { side: "SELL", price: 1399, quantity: 1, userId: "2" }
      ];

      const results = await Promise.all(
        orders.map(order => request(app).post("/order").send(order))
      );

      results.forEach((res, index) => {
        if (res.status !== 200) {
          console.log(`Order ${index} failed:`, res.body);
        }
      });

      expect(results.every(res => res.status === 200)).toBe(true);
    });

    
    
  });

  describe("Quote Functionality", () => {
    beforeEach(async () => {
      await request(app).post("/reset").send();
    });

    it("provides accurate quotes for various scenarios", async () => {
      await request(app).post("/order").send({
        side: "SELL", price: 1400, quantity: 2, userId: "1"
      });
      await request(app).post("/order").send({
        side: "SELL", price: 1401, quantity: 3, userId: "1"
      });
      await request(app).post("/order").send({
        side: "BUY", price: 1399, quantity: 4, userId: "2"
      });

      let quoteRes = await request(app).post("/quote").send({
        side: "BUY", quantity: 2
      });
      expect(quoteRes.body.quote).toBe(1400 * 2);

      quoteRes = await request(app).post("/quote").send({
        side: "BUY", quantity: 4
      });
      expect(quoteRes.body.quote).toBe(1400 * 2 + 1401 * 2);

      quoteRes = await request(app).post("/quote").send({
        side: "SELL", quantity: 3
      });
      expect(quoteRes.body.quote).toBe(1399 * 3);
    });

    it("returns an error for quotes exceeding available liquidity", async () => {
      const quoteRes = await request(app).post("/quote").send({
        side: "BUY", quantity: 1000
      });

      expect(quoteRes.status).toBe(400);
      expect(quoteRes.body.error).toBe("Not enough liquidity");
    });
  });

  describe("Order Cancellation", () => {
    // beforeEach(async () => {
    //   await request(app).post("/reset").send();
    // })
    it("successfully cancels an existing order", async () => {
      const orderRes = await request(app).post("/order").send({
        side: "BUY", price: 1400, quantity: 2, userId: "1"
      });

      console.log("Order response:", orderRes.body);

      const cancelRes = await request(app).post("/cancel").send({
        orderId: orderRes.body.orderId,
        userId: "1"
      });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.message).toBe("Order cancelled successfully");

      const depthRes = await request(app).get("/depth").send();
      expect(depthRes.body.depth["1400"]).toBeUndefined();
    });

    it("fails to cancel a non-existent order", async () => {
      const cancelRes = await request(app).post("/cancel").send({
        orderId: "non-existent-id",
        userId: "1"
      });

      expect(cancelRes.status).toBe(404);
      expect(cancelRes.body.error).toBe("Order not found");
    });
  });
});