import { useEffect, useState } from "react";
import { fetchProducts, syncPendingSales } from "../api/client";
import { queueSale } from "../db/localQueue";

interface Product {
  id: string;
  name: string;
  price: number;
  stockQty: number;
}

interface CartLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export function PosTerminal() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MPESA" | "CARD">("CASH");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => setStatus("Could not load products — check backend connection"));

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  const total = cart.reduce((sum, l) => sum + l.price * l.qty, 0);

  async function handleCheckout() {
    if (cart.length === 0) return;
    if (paymentMethod === "MPESA" && !phoneNumber) {
      setStatus("Enter a phone number for M-Pesa payment");
      return;
    }

    const localId = `sale_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = {
      items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
      paymentMethod,
      phoneNumber: paymentMethod === "MPESA" ? phoneNumber : undefined,
    };

    // Always queue locally first — this is what makes the till keep working
    // through a network drop. If we're online, we immediately try to flush
    // the queue too, so the common case still feels instant.
    await queueSale({ localId, payload, createdAt: Date.now(), synced: false });
    setCart([]);
    setPhoneNumber("");

    if (isOnline) {
      const result = await syncPendingSales();
      setStatus(
        result.failed > 0
          ? `Sale saved locally, ${result.failed} pending sync (will retry)`
          : "Sale completed and synced"
      );
    } else {
      setStatus("Offline — sale saved locally, will sync automatically when back online");
    }
  }

  return (
    <div className="pos-terminal">
      <div className={`status-bar ${isOnline ? "online" : "offline"}`}>
        {isOnline ? "● Online" : "● Offline — sales are queuing locally"}
      </div>

      <div className="pos-layout">
        <div className="product-grid">
          {products.map((p) => (
            <button key={p.id} className="product-tile" onClick={() => addToCart(p)}>
              <span className="name">{p.name}</span>
              <span className="price">KSh {p.price.toFixed(2)}</span>
            </button>
          ))}
        </div>

        <div className="cart-panel">
          <h2>Cart</h2>
          {cart.length === 0 && <p className="muted">No items yet</p>}
          {cart.map((l) => (
            <div key={l.productId} className="cart-line">
              <span>{l.name} × {l.qty}</span>
              <span>KSh {(l.price * l.qty).toFixed(2)}</span>
              <button onClick={() => removeLine(l.productId)}>✕</button>
            </div>
          ))}

          <div className="cart-total">Total: KSh {total.toFixed(2)}</div>

          <div className="payment-select">
            <label>
              <input type="radio" checked={paymentMethod === "CASH"} onChange={() => setPaymentMethod("CASH")} />
              Cash
            </label>
            <label>
              <input type="radio" checked={paymentMethod === "MPESA"} onChange={() => setPaymentMethod("MPESA")} />
              M-Pesa
            </label>
            <label>
              <input type="radio" checked={paymentMethod === "CARD"} onChange={() => setPaymentMethod("CARD")} />
              Card
            </label>
          </div>

          {paymentMethod === "MPESA" && (
            <input
              placeholder="2547XXXXXXXX"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
          )}

          <button className="checkout-btn" onClick={handleCheckout} disabled={cart.length === 0}>
            Charge KSh {total.toFixed(2)}
          </button>

          {status && <p className="status-msg">{status}</p>}
        </div>
      </div>
    </div>
  );
}
