import React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/components/utils/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

export function MultiSelectCoin({ options, selectedValues, onChange, className, placeholder = "Select coins..." }) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (value) => {
    const newSelectedValues = selectedValues.includes(value)
      ? selectedValues.filter((item) => item !== value)
      : [...selectedValues, value];
    onChange(newSelectedValues.sort());
  };

  const selectedLabels = selectedValues.map(val => {
    const option = options.find(opt => opt.value === val);
    return option ? option.label : val;
  });

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-10" // Ensure consistent height
          >
            <span className="truncate">
              {selectedValues.length === 0
                ? placeholder
                : selectedValues.length <= 2
                ? selectedLabels.join(', ')
                : `${selectedValues.length} coins selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 max-h-80 overflow-y-auto">
          <Command>
            <CommandInput placeholder="Search coins..." />
            <CommandList>
              <CommandEmpty>No coin found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleSelect(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedValues.includes(option.value) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              {selectedValues.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => onChange([])}
                      className="text-xs text-muted-foreground justify-center"
                    >
                      Clear selection
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedValues.length > 0 && (
        <div className="pt-2 flex flex-wrap gap-1">
          {selectedLabels.slice(0, 5).map((label, index) => ( // Show first 5 badges
            <Badge key={selectedValues[index]} variant="secondary" className="text-xs">
              {label}
            </Badge>
          ))}
          {selectedValues.length > 5 && (
            <Badge variant="outline" className="text-xs">
              +{selectedValues.length - 5} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}