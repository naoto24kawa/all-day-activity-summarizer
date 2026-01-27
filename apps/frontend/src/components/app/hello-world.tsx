import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function HelloWorld() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-4xl font-bold text-center">Hello World</CardTitle>
          <CardDescription className="text-center">Hono + React + shadcn/ui</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-muted-foreground">
            このテンプレートはHono、React、shadcn/uiを使用しています。
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="default">Default Button</Button>
            <Button variant="outline">Outline Button</Button>
          </div>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">Powered by Hono & shadcn/ui</p>
        </CardFooter>
      </Card>
    </div>
  );
}
