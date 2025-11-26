import { HomePage } from "./components/HomePage";

type AppProps = {
  serviceAccountEmail: string;
};

export const App: React.FC<AppProps> = ({ serviceAccountEmail }) => {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">
      <HomePage serviceAccountEmail={serviceAccountEmail} />
    </main>
  );
};
