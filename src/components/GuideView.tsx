import React from 'react';
import { BookOpen, ShieldAlert, Wrench } from 'lucide-react';

const TROUBLESHOOTING_ROWS = [
  {
    problem: 'Aucune capture OCR détectée dans la zone',
    cause: 'Coordonnées ZONE décalées ou écran agrandi (125% / 150%)',
    solution:
      'Utilise la prévisualisation en direct dans Collecteur & Calibration, ajuste left/top/width/height jusqu’à voir nettement le multiplicateur dans l’aperçu binarisé.',
  },
  {
    problem: 'Valeurs aberrantes enregistrées dans SQLite',
    cause: 'L’OCR ou le sélecteur lit un autre chiffre de la page',
    solution:
      'Contrôle les 20 premières valeurs dans l’onglet Base SQLite, supprime les lignes aberrantes et resserre la zone de lecture autour du seul multiplicateur.',
  },
  {
    problem: 'Le sélecteur CSS ne renvoie rien sur le site cible',
    cause: 'Chiffre dessiné dans un élément <canvas> ou bloqué par CORS/anti-bot',
    solution:
      'Passe à la Capture d’écran + OCR navigateur (fonctionne même sur les jeux en Canvas) ou utilise le Pont Bookmarklet directement dans l’onglet du jeu.',
  },
  {
    problem: 'Page de prédiction en attente de données',
    cause: 'Moins de 10 tours enregistrés dans tours.db',
    solution:
      'Lance le collecteur OCR, utilise le pont sélecteur Web, importe un fichier CSV ou saisis au moins 10 tours.',
  },
  {
    problem: 'Le modèle paraît gagnant sur 50 à 100 tours',
    cause: 'Variance statistique naturelle sur petit échantillon',
    solution:
      'Exige plusieurs milliers de tours et vérifie que p ≤ 0,05 ainsi que le backtest hors-échantillon (30%) battent durablement la médiane.',
  },
];

export const GuideView: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-2.5">
            <BookOpen className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
            <h2 className="text-lg font-semibold text-slate-900">
              Comment lire les résultats avec honnêteté
            </h2>
          </div>

          <ul className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <li>
              <strong className="text-slate-900">Corrélation avec p &gt; 0,05 :</strong> le tour précédent
              ne fournit aucune information exploitable sur le tour suivant.
            </li>
            <li>
              <strong className="text-slate-900">Modèle qui ne bat pas la moyenne ou la médiane :</strong>{' '}
              aucune prédiction utile n’existe dans les données ; le modèle se comporte comme un vrai hasard.
            </li>
            <li>
              <strong className="text-slate-900">Gain moyen négatif par tour :</strong> c’est l’avantage
              mathématique de la maison, comportement normal sur ce type de jeu.
            </li>
            <li>
              <strong className="text-slate-900">Bon résultat sur 50 ou 100 tours :</strong> sur peu de
              tours, la chance suffit à faire croire à une méthode gagnante. Exige plusieurs milliers de
              tours avant de conclure.
            </li>
            <li>
              <strong className="text-slate-900">Évaluation sans triche :</strong> chaque prédiction est
              enregistrée avant de connaître le résultat du tour, puis le modèle Gradient Boosting se
              ré-entraîne automatiquement tous les 50 tours à partir du 110e tour.
            </li>
          </ul>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <h2 className="text-lg font-semibold text-slate-900">Limites & principes d’utilisation</h2>
          </div>

          <ul className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <li>
              <strong className="text-slate-900">Aucune mise réelle :</strong> ce programme observe,
              enregistre dans SQLite et simule des gains/pertes virtuels. Il ne place aucun pari.
            </li>
            <li>
              <strong className="text-slate-900">Affichage vs calcul serveur :</strong> un site peut
              afficher autre chose que ce qu’il calcule ; ces tests détectent des anomalies statistiques,
              ils ne prouvent pas l’équité cryptographique à 100 %.
            </li>
            <li>
              <strong className="text-slate-900">Précision de l’OCR :</strong> vérifie toujours les 20
              premiers tours capturés manuellement et corrige la zone si des chiffres sont mal lus.
            </li>
            <li>
              <strong className="text-slate-900">Conditions d’utilisation :</strong> vérifie les règles du
              site observé, certaines plateformes interdisent la lecture automatisée par script.
            </li>
          </ul>
        </section>
      </div>

      {/* Troubleshooting Table */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <Wrench className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Dépannage rapide</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4">Problème</th>
                <th className="py-2.5 px-4">Cause probable</th>
                <th className="py-2.5 pl-4">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {TROUBLESHOOTING_ROWS.map((item) => (
                <tr key={item.problem} className="align-top">
                  <td className="py-3 pr-4 font-medium text-slate-900">{item.problem}</td>
                  <td className="py-3 px-4 text-slate-600">{item.cause}</td>
                  <td className="py-3 pl-4 text-slate-700 leading-relaxed">{item.solution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
