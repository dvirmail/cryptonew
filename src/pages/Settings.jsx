import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { ScanSettings } from "@/api/entities";
import { User } from "@/api/entities";
import { getAutoScannerService } from '@/components/services/AutoScannerService';
import { debugTelegramSettings } from '@/api/functions';
import { Loader2, Send } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({
    telegram_token: '',
    telegram_chat_id: '',
  });
  const [settingsId, setSettingsId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const loadSettings = async () => {
      setIsLoading(true);
      try {
        const settingsData = await ScanSettings.list();
        if (settingsData.length > 0) {
          setSettings({
            telegram_token: settingsData[0].telegram_token || '',
            telegram_chat_id: settingsData[0].telegram_chat_id || '',
          });
          setSettingsId(settingsData[0].id);
        }
      } catch (error) {
        console.error("Error loading settings:", error);
        toast({
          title: "Error",
          description: "Failed to load settings.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [toast]);

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setSettings(prev => ({ ...prev, [id]: value }));
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      if (settingsId) {
        await ScanSettings.update(settingsId, settings);
      } else {
        const newSettings = await ScanSettings.create(settings);
        setSettingsId(newSettings.id);
      }
      toast({
        title: "Success",
        description: "Settings saved successfully.",
      });
    } catch (error) {
      console.error("Error saving settings:", error);
      toast({
        title: "Error",
        description: "Failed to save settings.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setIsTesting(true);
    try {
      const response = await debugTelegramSettings({
        message: "This is a test message from your CryptoSentinel App.",
      });
      if (response.data.success) {
        toast({
          title: "Message Sent",
          description: "Check your Telegram for a test message.",
        });
      } else {
        throw new Error(response.data.error || "Unknown error sending message.");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to send test message: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Telegram Notifications</CardTitle>
          <CardDescription>
            Configure your Telegram bot to receive real-time trade alerts. These settings are stored securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="telegram_token">Telegram Bot Token</Label>
            <Input
              id="telegram_token"
              type="password"
              value={settings.telegram_token}
              onChange={handleInputChange}
              placeholder="Enter your bot token"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telegram_chat_id">Telegram Chat ID</Label>
            <Input
              id="telegram_chat_id"
              value={settings.telegram_chat_id}
              onChange={handleInputChange}
              placeholder="Enter your chat ID"
            />
          </div>
          <div className="flex justify-between items-center pt-4">
            <Button onClick={handleSaveSettings} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Settings
            </Button>
            <Button variant="outline" onClick={handleTestTelegram} disabled={isTesting || !settings.telegram_token || !settings.telegram_chat_id}>
              {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Test Message
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}