import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Barcode, Camera, Loader2, Check } from "lucide-react";

interface SellProductDialogProps {
  shopId: string;
  onSold: () => void;
}

const SellProductDialog = ({ shopId, onSold }: SellProductDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [barcode, setBarcode] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const decrementBatch = async (batchId: string) => {
    setLoading(true);
    try {
      const { data: batch } = await supabase
        .from("inventory_batches")
        .select("id, quantity")
        .eq("id", batchId)
        .single();

      if (!batch || batch.quantity <= 0) {
        toast({ title: "Out of stock", description: "No quantity left" });
        return;
      }

      const { error: updateError } = await supabase
        .from("inventory_batches")
        .update({ quantity: batch.quantity - 1 })
        .eq("id", batchId);

      if (updateError) throw updateError;

      toast({ title: "Sold", description: "Quantity decremented by 1", icon: <Check className="w-4 h-4" /> });
      onSold();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const findBatchForProductId = async (productId: string) => {
    const { data } = await supabase
      .from("inventory_batches")
      .select("id, quantity")
      .eq("product_id", productId)
      .eq("shop_id", shopId)
      .eq("status", "active")
      .order("expiry_date", { ascending: true })
      .limit(1);
    return data && data[0];
  };

  const sellByGTIN = async (gtin: string) => {
    setLoading(true);
    try {
      const { data: product } = await supabase
        .from("products")
        .select("id")
        .eq("gtin", gtin)
        .maybeSingle();

      if (!product) {
        toast({ title: "Not found", description: "No product with this barcode" });
        return;
      }

      const batch = await findBatchForProductId(product.id);
      if (!batch) {
        toast({ title: "No active batch", description: "No stock for this product" });
        return;
      }
      await decrementBatch(batch.id);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const normalize = (s?: string) => (s || "").toLowerCase().trim().replace(/\s+/g, " ");

  const sellByFuzzyMatch = async (name?: string, brand?: string) => {
    const nName = normalize(name);
    const nBrand = normalize(brand);

    const { data: batches } = await supabase
      .from("inventory_batches")
      .select("id, quantity, product_id")
      .eq("shop_id", shopId)
      .eq("status", "active");

    const list = batches || [];
    if (list.length === 0) return false;

    const productIds = Array.from(new Set(list.map((b: any) => b.product_id).filter(Boolean)));
    let productsMap: Record<string, any> = {};
    if (productIds.length) {
      const pr = await supabase
        .from("products")
        .select("id, name, brand, gtin")
        .in("id", productIds);
      if (!pr.error && pr.data) {
        pr.data.forEach((p: any) => { productsMap[p.id] = p; });
      }
    }

    const scored = list
      .map((b: any) => {
        const p = productsMap[b.product_id] || {};
        const pn = normalize(p.name);
        const pb = normalize(p.brand);
        let score = 0;
        if (nName && pn) {
          if (pn === nName) score += 3;
          else if (pn.includes(nName) || nName.includes(pn)) score += 2;
        }
        if (nBrand && pb) {
          if (pb === nBrand) score += 1;
          else if (pb && nBrand && (pb.includes(nBrand) || nBrand.includes(pb))) score += 0.5;
        }
        return { id: b.id, quantity: b.quantity, score };
      })
      .filter((b: any) => (b.quantity || 0) > 0 && b.score > 0)
      .sort((a: any, b: any) => b.score - a.score);

    const best = scored[0];
    if (best) {
      await decrementBatch(best.id);
      return true;
    }
    return false;
  };

  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim()) return;
    await sellByGTIN(barcode.trim());
  };

  const handleImageScan = async (file: File) => {
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64 = reader.result?.toString().split(",")[1];
        if (!base64) throw new Error("Failed to read image");
        const { data, error } = await supabase.functions.invoke("ocr-scan", {
          body: { imageBase64: base64 },
        });
        if (error) throw error;
        const gtin = data?.gtin;
        if (gtin) {
          await sellByGTIN(gtin);
        } else if (data?.productName) {
          const triedFuzzy = await sellByFuzzyMatch(data.productName, data.brand);
          if (!triedFuzzy) {
            const { data: product } = await supabase
              .from("products")
              .select("id")
              .ilike("name", `%${data.productName}%`)
              .maybeSingle();
            if (product) {
              const batch = await findBatchForProductId(product.id);
              if (batch) await decrementBatch(batch.id);
              else toast({ title: "No active batch", description: "No stock for this product" });
            } else {
              toast({ title: "Not found", description: "Product not found from scan" });
            }
          }
        } else {
          toast({ title: "Scan failed", description: "Could not extract product info" });
        }
      };
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          Sell / Scan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Sell Product</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <form onSubmit={handleBarcodeSubmit} className="space-y-2">
            <Label>Barcode/GTIN</Label>
            <div className="flex gap-2">
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="e.g., 8901234567890" />
              <Button type="submit" disabled={loading}>
                <Barcode className="w-4 h-4 mr-2" />
                Sell 1
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <Label>Scan Image</Label>
            <div className="flex items-center gap-2">
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageScan(file);
              }} />
              <Button type="button" variant="secondary" onClick={() => imageInputRef.current?.click()} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                Scan & Sell 1
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SellProductDialog;