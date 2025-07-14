import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

export default function SettingsPage() {
  return (
    <div className="flex h-full w-full flex-col justify-start overflow-hidden px-5 py-12">
      <div className="mb-6 space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your account settings and set e-mail preferences.</p>
      </div>
      <div className="flex flex-col">
        <Card className="lg:max-w-2xl">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose your preferred theme and font size.</CardDescription>
          </CardHeader>
          <CardContent>
            
          </CardContent>
        </Card>
      </div>
    </div>
  );
}