import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';

const OptOutDialog = ({ isOpen, onClose, combination, onConfirm }) => {
  const [scope, setScope] = useState('this_coin'); // 'this_coin' or 'all_coins'
  const [isSaving, setIsSaving] = useState(false);

  if (!combination) return null;

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      await onConfirm(combination, scope);
    } finally {
      setIsSaving(false);
    }
  };

  const signature = (combination.signals || []).map(s => s.type).sort().join(' + ');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Opt-Out Strategy</DialogTitle>
          <DialogDescription>
            You are about to disable strategies based on the signal pattern:
            <br />
            <span className="font-semibold text-primary">{signature}</span>.
            <br />
            This will exclude them from the Auto Scanner and future backtests.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              This action can be reversed from the "Opted-Out Strategies" page in the Backtesting section.
            </AlertDescription>
          </Alert>

          <div>
            <Label className="font-semibold">Select Opt-Out Scope:</Label>
            <RadioGroup value={scope} onValueChange={setScope} className="mt-2 space-y-2">
              <Label 
                htmlFor="r1" 
                className="flex items-start p-3 border rounded-md has-[:checked]:bg-muted has-[:checked]:border-primary transition-all cursor-pointer"
              >
                <RadioGroupItem value="this_coin" id="r1" className="mt-0.5" />
                <div className="ml-3">
                    <span className="font-medium">This Specific Strategy Only</span>
                    <p className="text-sm text-muted-foreground">Only opt-out this strategy for <span className="font-semibold">{combination.coin}</span>.</p>
                </div>
              </Label>
              <Label 
                htmlFor="r2" 
                className="flex items-start p-3 border rounded-md has-[:checked]:bg-muted has-[:checked]:border-primary transition-all cursor-pointer"
              >
                <RadioGroupItem value="all_coins" id="r2" className="mt-0.5" />
                 <div className="ml-3">
                    <span className="font-medium">All Strategies with this Signal Pattern</span>
                    <p className="text-sm text-muted-foreground">Opt-out ALL strategies that use this signal combination, across ALL coins.</p>
                </div>
              </Label>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Confirm Opt-Out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OptOutDialog;