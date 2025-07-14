"use client";

import { Button } from "@workspace/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { TypeIcon, Code2Icon, ChevronDownIcon } from "lucide-react";
import { ReactNode } from "react";

export interface FontOption {
  value: string;
  label: string;
  cssVar: string;
}

interface FontSwitcherProps {
  options: readonly FontOption[];
  currentValue: string;
  onValueChange: (value: string) => void;
  icon?: ReactNode;
  previewText?: string;
  className?: string;
}

export function FontSwitcher({ 
  options, 
  currentValue, 
  onValueChange, 
  icon, 
  previewText = "Aa",
  className 
}: FontSwitcherProps) {
  const currentOption = options.find(option => option.value === currentValue);
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className={className}
          style={{ fontFamily: currentOption?.cssVar }}
        >
          {icon}
          <span className="flex-1 text-left">{currentOption?.label}</span>
          <ChevronDownIcon className="h-4 w-4 ml-2 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup 
          value={currentValue} 
          onValueChange={onValueChange}
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
                {previewText}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Convenience components for common use cases
interface InterfaceFontSwitcherProps {
  options: readonly FontOption[];
  currentValue: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function InterfaceFontSwitcher(props: InterfaceFontSwitcherProps) {
  return (
    <FontSwitcher
      {...props}
      icon={<TypeIcon className="h-4 w-4 mr-2" />}
      previewText="Aa"
    />
  );
}

export function CodeFontSwitcher(props: InterfaceFontSwitcherProps) {
  return (
    <FontSwitcher
      {...props}
      icon={<Code2Icon className="h-4 w-4 mr-2" />}
      previewText="</>"
    />
  );
}