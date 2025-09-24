import React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@agentview/studio/components/ui/popover"
import { Button } from "@agentview/studio/components/ui/button"
import { Check, ChevronsUpDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@agentview/studio/components/ui/command"
import { products } from "./products"

export function ProductSelect({ value, onChange }: { value: string, onChange?: (product: string | undefined) => void }) {
  const [open, setOpen] = React.useState(false)
  const [selectedProduct, setSelectedProduct] = React.useState(products.find((product) => product.id === value))

  return (<div>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="justify-between h-auto">
          {selectedProduct && <img src={selectedProduct.image_url} alt={selectedProduct.name} className="w-full h-full object-cover max-w-[40px]" />
          }
          {selectedProduct ? selectedProduct.name : "Select product..."}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput placeholder="Search product..." className="h-9" />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.name}
                  onSelect={(newSelectedProductName) => {
                    const newSelectedProduct = products.find((product) => product.name === newSelectedProductName)

                    if (!newSelectedProduct) {
                      throw new Error("unexpected error in product select")
                    }

                    setSelectedProduct(newSelectedProduct)
                    onChange?.(newSelectedProduct.id)
                    setOpen(false)
                  }}
                >
                  <img src={product.image_url} alt={product.name} className="w-8 h-8 mr-2" />
                  {product.name}
                  <Check className={`ml-auto ${product.id === selectedProduct?.id ? "opacity-100" : "opacity-0"}`} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover></div>
  )
}
