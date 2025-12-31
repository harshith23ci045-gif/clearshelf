import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import ProductCard from "./ProductCard";

const ProductFeed = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();

    const channel = supabase
      .channel("product-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_batches",
        },
        () => {
          loadProducts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (search) {
      setFilteredProducts(
        products.filter(
          (p) =>
            p.products &&
            (p.products.name.toLowerCase().includes(search.toLowerCase()) ||
            p.products.brand?.toLowerCase().includes(search.toLowerCase()) ||
            p.products.category.toLowerCase().includes(search.toLowerCase()))
        )
      );
    } else {
      setFilteredProducts(products);
    }
  }, [search, products]);

  const loadProducts = async () => {
    setLoading(true);
    const primary = await supabase
      .from("inventory_batches")
      .select(`*, products (name, brand, category), shops (name, address)`) 
      .eq("status", "active")
      .order("discount_percent", { ascending: false });

    if (!primary.error && primary.data && primary.data.length > 0) {
      const validData = primary.data.filter((batch: any) => batch.products && batch.shops);
      setProducts(validData);
      setFilteredProducts(validData);
      setLoading(false);
      return;
    }

    const fallbackBatches = await supabase
      .from("inventory_batches")
      .select("*")
      .eq("status", "active")
      .order("discount_percent", { ascending: false });

    if (fallbackBatches.error || !fallbackBatches.data) {
      setProducts([]);
      setFilteredProducts([]);
      setLoading(false);
      return;
    }

    const batches = fallbackBatches.data as any[];
    const productIds = Array.from(new Set(batches.map(b => b.product_id).filter(Boolean)));
    const shopIds = Array.from(new Set(batches.map(b => b.shop_id).filter(Boolean)));

    let productsMap: Record<string, any> = {};
    let shopsMap: Record<string, any> = {};

    if (productIds.length) {
      const pr = await supabase.from("products").select("id, name, brand, category").in("id", productIds);
      if (!pr.error && pr.data) {
        pr.data.forEach((p: any) => {
          productsMap[p.id] = p;
        });
      }
    }

    if (shopIds.length) {
      const sr = await supabase.from("shops").select("id, name, address").in("id", shopIds);
      if (!sr.error && sr.data) {
        sr.data.forEach((s: any) => {
          shopsMap[s.id] = s;
        });
      }
    }

    const composed = batches
      .map(b => ({
        ...b,
        products: productsMap[b.product_id],
        shops: shopsMap[b.shop_id],
      }))
      .filter(b => b.products && b.shops);

    setProducts(composed);
    setFilteredProducts(composed);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading products...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search products, brands, or categories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {search ? "No products found matching your search." : "No products available."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((item) => (
              <ProductCard key={item.id} batch={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductFeed;