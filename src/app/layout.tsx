import { PropsWithChildren } from 'react';

import '@/styles/globals.css';

const RootLayout = (props: PropsWithChildren) => {
	return (
		<html lang='en'>
			<body>{props.children}</body>
		</html>
	);
};

export default RootLayout;

export const metadata = {};
