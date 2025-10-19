import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

// This component is now for filtering VIRTUAL trades
export default function TradeFilters({
  filters,
  setFilters,
  pairs,
  exitReasons
}) {
  const handleDateChange = (field, date) => {
    setFilters(prev => ({
      ...prev,
      [field]: date
    }));
  };

  const handleInputChange = (e) => {
    setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 items-end">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Pair</label>
        <Select
          value={filters.pair}
          onValueChange={(value) => setFilters(prev => ({ ...prev, pair: value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Trading Pair" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pairs</SelectItem>
            {pairs.map(pair => (
              <SelectItem key={pair} value={pair}>
                {pair}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Direction</label>
        <Select
          value={filters.direction}
          onValueChange={(value) => setFilters(prev => ({ ...prev, direction: value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Directions</SelectItem>
            <SelectItem value="long">Long</SelectItem>
            <SelectItem value="short">Short</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Result</label>
        <Select
          value={filters.result}
          onValueChange={(value) => setFilters(prev => ({ ...prev, result: value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Result" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Results</SelectItem>
            <SelectItem value="profit">Profit</SelectItem>
            <SelectItem value="loss">Loss</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Exit Reason</label>
        <Select
          value={filters.exit_reason}
          onValueChange={(value) => setFilters(prev => ({ ...prev, exit_reason: value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Exit Reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            {exitReasons.map(reason => (
              <SelectItem key={reason} value={reason}>
                {reason.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Strategy Name</label>
        <Input
          name="strategy_name"
          placeholder="Filter by strategy..."
          value={filters.strategy_name}
          onChange={handleInputChange}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="space-y-1 w-full">
            <label className="text-xs text-muted-foreground">Start Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.startDate ? format(filters.startDate, "PPP") : "Start Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={filters.startDate}
                  onSelect={(date) => handleDateChange("startDate", date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
        </div>
        
        <div className="space-y-1 w-full">
            <label className="text-xs text-muted-foreground">End Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.endDate ? format(filters.endDate, "PPP") : "End Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={filters.endDate}
                  onSelect={(date) => handleDateChange("endDate", date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
        </div>
      </div>
    </div>
  );
}