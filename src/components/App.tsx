import { HomePage } from "./HomePage";

export type AppProps = {
  serviceAccountEmail: string;
};

export function App({ serviceAccountEmail }: AppProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Meet Recording Quiz Maker</title>
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">
          <HomePage serviceAccountEmail={serviceAccountEmail} />
        </main>
      </body>
    </html>
  );
}
