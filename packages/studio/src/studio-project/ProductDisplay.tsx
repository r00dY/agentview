import { products } from "./products"

export function ProductDisplay({ value }: { value: string }) {
  const product = products.find((product) => product.id === value)
  
  if (!product) {
    return (
      <div className="text-muted-foreground">No product selected</div>
    )
  }

  return (
    <div className="flex items-center space-x-3 pl-1 pr-3 py-2 border border-input bg-background rounded-md h-10">
      <img 
        src={product.image_url} 
        alt={product.name} 
        className="w-8 h-8 object-cover rounded-sm flex-shrink-0 mr-1" 
      />
      <span className="text-sm font-medium truncate">{product.name}</span>
    </div>
  )
}