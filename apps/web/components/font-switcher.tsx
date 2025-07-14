"use client";

import { useAppearance, fontStyleOptions, monoFontStyleOptions, FontStyle, MonoFontStyle } from "@/contexts/appearance-context";
import { Button } from "@workspace/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { TypeIcon, Code2Icon } from "lucide-react";

interface FontSwitcherProps {
  type: 'interface' | 'code';
}

export function FontSwitcher({ type }: FontSwitcherProps) {
  const { fontStyle, setFontStyle, monoFontStyle, setMonoFontStyle } = useAppearance();
  
  const isInterface = type === 'interface';
  const currentValue = isInterface ? fontStyle : monoFontStyle;
  const options = isInterface ? fontStyleOptions : monoFontStyleOptions;
  const handleChange = isInterface ? setFontStyle : setMonoFontStyle;
  
  const currentOption = options.find(option => option.value === currentValue);
  const Icon = isInterface ? TypeIcon : Code2Icon;
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon className="h-4 w-4 mr-2" />
          {currentOption?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup 
          value={currentValue} 
          onValueChange={(value) => handleChange(value as FontStyle & MonoFontStyle)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem 
              key={option.value} 
              value={option.value}
              className="flex items-center justify-between"
            >
              <span 
                style={{ fontFamily: option.cssVar }}
                className="flex-1"
              >
                {option.label}
              </span>
              <span 
                style={{ fontFamily: option.cssVar }}
                className="text-xs text-muted-foreground ml-2"
              >
                {isInterface ? 'Aa' : '</>'}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}